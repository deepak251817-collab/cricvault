import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import { Crest, Empty, Modal, Spinner, StatusBadge, formatDate } from '../ui.jsx';

const WICKET_TYPES = [
  'bowled',
  'caught',
  'lbw',
  'stumped',
  'run out',
  'hit wicket',
  'caught and bowled',
  'retired hurt',
  'obstructing the field',
];

// On a no-ball, and on the free hit that follows one, only a run out or an
// obstruction can dismiss a batter (IPL / MCC law).
const FREE_HIT_WICKETS = ['run out', 'obstructing the field'];

const overs = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

// Bowlers and all-rounders are read by the bowling they offer: pace or spin.
const PACE = { fast: 'F', medium: 'M', spin: 'S' };
const styleMark = (player) =>
  ['allrounder', 'bowler'].includes(player.role) && player.bowl_style
    ? PACE[player.bowl_style] || player.bowl_style[0].toUpperCase()
    : '';

const ROLE_TEXT = { batter: 'batter', bowler: 'bowler', allrounder: 'all-rounder', wicketkeeper: 'keeper' };
const bowls = (player) => player.role === 'bowler' || player.role === 'allrounder';
const playerDetail = (player) => {
  const role = ROLE_TEXT[player.role] || player.role || '';
  if (bowls(player)) return [role, player.bowl_style ? `${player.bowl_style} bowler` : 'part-timer'].filter(Boolean).join(' · ');
  const hand = player.batting_style === 'left' ? 'left hand' : player.batting_style === 'right' ? 'right hand' : '';
  return [role, hand].filter(Boolean).join(' · ');
};

function SetupXI({ data, onStarted }) {
  const toast = useToast();
  const match = data.match;
  const squadA = data.squads[match.team_a_id] || [];
  const squadB = data.squads[match.team_b_id] || [];
  const [xiA, setXiA] = useState([]);
  const [xiB, setXiB] = useState([]);
  const [wkA, setWkA] = useState('');
  const [wkB, setWkB] = useState('');
  const [capA, setCapA] = useState('');
  const [capB, setCapB] = useState('');
  const [tossWinner, setTossWinner] = useState(String(match.team_a_id));
  const [decision, setDecision] = useState('bat');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setWkA(String(squadA.find((p) => p.is_wicketkeeper)?.id || ''));
    setWkB(String(squadB.find((p) => p.is_wicketkeeper)?.id || ''));
    setCapA(String(squadA.find((p) => p.is_captain)?.id || ''));
    setCapB(String(squadB.find((p) => p.is_captain)?.id || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  const toggle = (team, id) => {
    const [list, setList, wk, setWk] = team === 'A' ? [xiA, setXiA, wkA, setWkA] : [xiB, setXiB, wkB, setWkB];
    const [cap, setCap] = team === 'A' ? [capA, setCapA] : [capB, setCapB];
    if (list.includes(id)) {
      setList(list.filter((x) => x !== id));
      if (String(wk) === String(id)) setWk('');
      if (String(cap) === String(id)) setCap('');
    } else if (list.length < 11) {
      setList([...list, id]);
      // A player who carries the role walks straight into the job.
      const player = (team === 'A' ? squadA : squadB).find((p) => p.id === id);
      if (player?.is_wicketkeeper && !wk) setWk(String(id));
      if (player?.is_captain && !cap) setCap(String(id));
    }
  };

  const start = async () => {
    setError('');
    if (xiA.length !== 11 || xiB.length !== 11) {
      setError('Name exactly 11 players for each team');
      return;
    }
    if (!wkA || !wkB) {
      setError('Name a wicketkeeper in each XI — the keeper role is set in the squad');
      return;
    }
    if (!capA || !capB) {
      setError('Name a captain in each XI — the captain role is set in the squad');
      return;
    }
    if (!xiA.includes(Number(capA)) || !xiB.includes(Number(capB))) {
      setError("Each team's captain must be in the playing XI");
      return;
    }
    setBusy(true);
    try {
      const res = await api(`/matches/${match.id}/start`, {
        method: 'POST',
        body: {
          tossWinnerId: Number(tossWinner),
          tossDecision: decision,
          xiA,
          xiB,
          wkA: Number(wkA),
          wkB: Number(wkB),
          captainA: capA ? Number(capA) : null,
          captainB: capB ? Number(capB) : null,
        },
      });
      toast('Match started');
      onStarted(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const panel = (team, squad, xi, setXi, wk, setWk, cap, setCap) => {
    const teamData = team === 'A' ? data.teamA : data.teamB;
    const inXi = xi.map((pid) => squad.find((s) => s.id === pid)).filter(Boolean);
    const keepers = inXi.filter((p) => p.is_wicketkeeper);
    const leaders = inXi.filter((p) => p.is_captain);
    return (
      <div className="panel">
        <div className="panel-head">
          <Crest team={teamData} size={24} />
          <h3>{teamData?.short_name} XI</h3>
          <span className="right tiny muted">{xi.length}/11 selected</span>
        </div>
        <div className="panel-body">
          {squad.length < 11 ? (
            <div className="error-text" style={{ marginBottom: 10 }}>
              {teamData?.name} has only {squad.length} players in the season squad. Add at least 11 before starting.
            </div>
          ) : null}
          <div className="pick-grid" style={{ maxHeight: 260 }}>
            {squad.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`pick ${xi.includes(p.id) ? 'on' : ''}`}
                onClick={() => toggle(team, p.id)}
              >
                <span className="pick-no" aria-hidden={!xi.includes(p.id)}>
                  {xi.includes(p.id) ? xi.indexOf(p.id) + 1 : ''}
                </span>
                <span>{p.name}</span>
                {p.is_wicketkeeper ? <span className="badge wk">WK</span> : null}
                {String(cap) === String(p.id) ? <span className="badge capt on">C</span> : null}
                <span className="role">
                  {p.role.slice(0, 3)}
                  {styleMark(p) ? ` · ${styleMark(p)}` : ''}
                </span>
              </button>
            ))}
            {!squad.length ? <span className="muted small">No squad players.</span> : null}
          </div>
          {xi.length ? (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Wicketkeeper</label>
                <select
                  className="select"
                  value={wk}
                  onChange={(e) => setWk(e.target.value)}
                  disabled={!keepers.length}
                >
                  <option value="">{keepers.length ? 'Choose keeper' : 'No keeper in this XI'}</option>
                  {keepers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {xi.indexOf(p.id) + 1}. {p.name}
                      {p.is_wicketkeeper ? ' · WK' : ' · batter'}
                    </option>
                  ))}
                </select>
                {!keepers.length ? (
                  <span className="hint">
                    Only a player with the keeper role can keep.{' '}
                    <Link to={`/seasons/${match.season_id}`}>Mark one in the squad →</Link>
                  </span>
                ) : null}
              </div>
              <div className="field">
                <label>Captain</label>
                <select
                  className="select"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  disabled={!leaders.length}
                >
                  <option value="">{leaders.length ? 'Choose captain' : 'No captain in this XI'}</option>
                  {leaders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {xi.indexOf(p.id) + 1}. {p.name}
                    </option>
                  ))}
                </select>
                {!leaders.length ? (
                  <span className="hint">
                    Only the named captain can lead.{' '}
                    <Link to={`/seasons/${match.season_id}`}>Mark one in the squad →</Link>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <h3>Match setup</h3>
          <span className="sub">Toss first, then the two XIs</span>
        </div>
        <div className="panel-body">
          <div className="row wrap" style={{ gap: 16 }}>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Toss won by</label>
              <select className="select" value={tossWinner} onChange={(e) => setTossWinner(e.target.value)}>
                <option value={match.team_a_id}>{data.teamA?.name}</option>
                <option value={match.team_b_id}>{data.teamB?.name}</option>
              </select>
            </div>
            <div className="field">
              <label>Decision</label>
              <div className="seg">
                <button type="button" className={decision === 'bat' ? 'on' : ''} onClick={() => setDecision('bat')}>
                  Bat
                </button>
                <button type="button" className={decision === 'bowl' ? 'on' : ''} onClick={() => setDecision('bowl')}>
                  Bowl
                </button>
              </div>
            </div>
            <div className="grow" />
            <div className="tiny muted">
              {formatDate(match.scheduled_at)} {match.venue ? `· ${match.venue}` : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        {panel('A', squadA, xiA, setXiA, wkA, setWkA, capA, setCapA)}
        {panel('B', squadB, xiB, setXiB, wkB, setWkB, capB, setCapB)}
      </div>

      {error ? <div className="error-text" style={{ marginTop: 14 }}>{error}</div> : null}

      <div className="row" style={{ marginTop: 18 }}>
        <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
          {busy ? 'Starting…' : 'Start match'}
        </button>
        <span className="hint">
          Numbered in batting order · one keeper per XI · keeper and captain must carry those roles in the squad.
        </span>
      </div>
    </>
  );
}

export default function Scoring() {
  const { id } = useParams();
  const { user } = useApp();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wicketOpen, setWicketOpen] = useState(false);
  const [extraPick, setExtraPick] = useState(null);
  const [wicket, setWicket] = useState({ type: 'bowled', dismissedId: '', fielderId: '', noBall: false });
  const [openers, setOpeners] = useState({ strikerId: '', nonStrikerId: '', bowlerId: '' });

  const load = () => api(`/matches/${id}`).then(setData).catch((err) => toast(err.message, 'error'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const current = data?.current;
  const match = data?.match;

  useEffect(() => {
    setOpeners({ strikerId: '', nonStrikerId: '', bowlerId: '' });
    setExtraPick(null);
    setWicketOpen(false);
  }, [current?.inningsId]);

  const canScore = user.role === 'admin';

  const act = async (path, body) => {
    setBusy(true);
    try {
      const res = await api(`/matches/${id}${path}`, { method: 'POST', body });
      setData(res);
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Spinner label="Loading the match" />;

  const config = (
    <div className="page-head">
      <div className="titles">
        <div className="eyebrow">
          <Link to="/matches">Matches</Link> /{' '}
          <Link to={`/seasons/${match.season_id}`}>{data.season?.name || 'Season'}</Link>
        </div>
        <h1>
          {data.teamA?.short_name || 'TBD'} <span style={{ color: 'var(--muted)' }}>v</span>{' '}
          {data.teamB?.short_name || 'TBD'}
        </h1>
        <div className="row wrap" style={{ marginTop: 8, gap: 7 }}>
          <StatusBadge status={match.status} />
          <span className="badge role">{match.format?.toUpperCase()}</span>
          <span className="badge role">{match.overs ? `${match.overs} overs` : 'Unlimited overs'}</span>
          <span className="badge role">{match.innings_limit} innings</span>
          {match.stage === 'playoff' ? <span className="badge playoffs">{match.stage_name}</span> : null}
        </div>
      </div>
      <div className="page-actions">
        {match.toss_winner_id ? (
          <span className="tiny muted">
            Toss: {match.toss_winner_id === match.team_a_id ? data.teamA?.short_name : data.teamB?.short_name} chose to{' '}
            {match.toss_decision}
          </span>
        ) : null}
        <Link className="btn" to={`/matches/${match.id}/scorecard`}>
          Scorecard
        </Link>
      </div>
    </div>
  );

  if (!match.team_a_id || !match.team_b_id) {
    return (
      <>
        {config}
        <div className="panel">
          <Empty title="Teams not decided">This playoff match is waiting for earlier results.</Empty>
        </div>
      </>
    );
  }

  if (match.status === 'scheduled') {
    return (
      <>
        {config}
        {canScore ? (
          <SetupXI data={data} onStarted={(res) => setData(res)} />
        ) : (
          <div className="panel">
            <Empty title="Match not started">The administrator will set the XIs and start play.</Empty>
          </div>
        )}
      </>
    );
  }

  const battingXi = current ? data.xi.filter((x) => x.team_id === current.battingTeamId) : [];
  const bowlingXi = current ? data.xi.filter((x) => x.team_id === current.bowlingTeamId) : [];
  // XI order is the order the side was named in, so the card walks out the same way.
  const xiNo = (list, playerId) => {
    const at = list.findIndex((p) => String(p.player_id) === String(playerId));
    return at < 0 ? '' : `${at + 1}. `;
  };
  const frontlineBowlers = bowlingXi.filter(bowls);
  const partTimeBowlers = bowlingXi.filter((p) => !bowls(p));
  const card = current?.batting || [];
  const outIds = new Set(card.filter((b) => b.out).map((b) => b.playerId));
  const atCrease = new Set([current?.strikerId, current?.nonStrikerId].filter(Boolean));
  const availableBatters = battingXi.filter((x) => !outIds.has(x.player_id) && !atCrease.has(x.player_id));
  const needsOpeners = !!current && !current.closed && !current.strikerId && !current.nonStrikerId && card.length === 0;
  const needsBatter = !!current && current.needsNewBatter && !needsOpeners;
  const battingTeam = current ? (current.battingTeamId === data.teamA?.id ? data.teamA : data.teamB) : data.teamA;
  const bowlingTeam = current ? (current.bowlingTeamId === data.teamA?.id ? data.teamA : data.teamB) : data.teamB;
  const striker = card.find((b) => b.playerId === current?.strikerId);
  const nonStriker = card.find((b) => b.playerId === current?.nonStrikerId);
  const activeBowler = current?.bowling?.find((b) => b.playerId === current?.bowlerId);
  const lastInnings = data.innings[data.innings.length - 1];

  const scoreBall = async (payload) => {
    if (!current) return false;
    setBusy(true);
    try {
      const res = await api(`/matches/${id}/balls`, {
        method: 'POST',
        body: {
          inningsId: current.inningsId,
          strikerId: current.strikerId,
          nonStrikerId: current.nonStrikerId,
          bowlerId: current.bowlerId,
          ...payload,
        },
      });
      setData(res);
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitWicket = async () => {
    const restricted = current?.freeHit || wicket.noBall;
    const options = restricted ? FREE_HIT_WICKETS : WICKET_TYPES;
    const type = options.includes(wicket.type) ? wicket.type : options[0];
    const ok = await scoreBall({
      runs: 0,
      extraType: wicket.noBall ? 'nb' : null,
      extraRuns: wicket.noBall ? 1 : 0,
      wicket: {
        type,
        dismissedId: Number(wicket.dismissedId) || current.strikerId,
        fielderId: wicket.fielderId ? Number(wicket.fielderId) : null,
      },
    });
    if (!ok) return;
    setWicketOpen(false);
    setWicket({ type: 'bowled', dismissedId: '', fielderId: '', noBall: false });
  };

  const submitOpeners = async () => {
    const ok = await act('/openers', {
      inningsId: current.inningsId,
      strikerId: Number(openers.strikerId),
      nonStrikerId: Number(openers.nonStrikerId),
      bowlerId: Number(openers.bowlerId),
    });
    if (ok) toast('Play resumes');
  };

  const undo = async () => {
    if (!window.confirm('Undo the last ball?')) return;
    await act('/undo', {});
  };

  const declare = async () => {
    if (!window.confirm('Declare this innings closed?')) return;
    await act('/end-innings', { inningsId: current.inningsId, declare: true });
  };

  const abandon = async () => {
    if (!window.confirm('Abandon this match as a no result?')) return;
    await act('/abandon', {});
  };

  return (
    <>
      {config}

      {match.status === 'completed' || match.status === 'abandoned' ? (
        <div className="hero-live" style={{ marginBottom: 18 }}>
          <div className="inner">
            <div className="sb-top">
              <span>{data.season?.name}</span>
              <span>·</span>
              <span>Final</span>
              <StatusBadge status={match.status} />
            </div>
            <div className="sb-grid">
              <div>
                <div className="sb-score" style={{ fontSize: 34, letterSpacing: '0.02em' }}>
                  {match.result_text || 'No result'}
                </div>
                <div className="sb-meta">
                  {data.innings.map((inn) => (
                    <span key={inn.id}>
                      {inn.battingTeam?.short_name} <b>{inn.runs}/{inn.wickets}</b> ({inn.overs})
                    </span>
                  ))}
                </div>
              </div>
              <div className="sb-right">
                <Link className="btn btn-primary btn-block" to={`/matches/${match.id}/scorecard`}>
                  Full scorecard
                </Link>
                {canScore && data.innings.length ? (
                  <button type="button" className="btn btn-block" style={{ marginTop: 8 }} onClick={undo}>
                    Undo last ball
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {current ? (
        <div className="hero-live" style={{ marginBottom: 18 }}>
          <div className="inner">
            <div className="sb-top">
              <span>{data.season?.name}</span>
              <span>·</span>
              <span>Innings {current.inningsNo}</span>
              {match.status === 'live' ? (
                <StatusBadge status="live" />
              ) : (
                <span className="badge">{current.closed ? 'Closed' : 'In progress'}</span>
              )}
            </div>
            <div className="sb-grid">
              <div>
                <div className="sb-team">
                  <Crest team={battingTeam} size={24} />
                  {battingTeam?.name}
                </div>
                <div className="sb-score">
                  {current.runs}/{current.wickets}
                  <span className="ov">{current.overs} ov</span>
                </div>
                <div className="sb-meta">
                  {current.target ? (
                    <span>
                      Target <b>{current.target}</b> · need <b>{current.chase}</b> from{' '}
                      <b>{current.ballsRemaining ?? '∞'}</b> balls
                    </span>
                  ) : (
                    <span>1st innings</span>
                  )}
                  <span>
                    CRR <b>{current.runRate}</b>
                  </span>
                  {current.requiredRate ? (
                    <span>
                      RRR <b>{current.requiredRate}</b>
                    </span>
                  ) : null}
                  <span>{current.extrasTotal} extras</span>
                </div>
                <div className="ball-row" style={{ marginTop: 12 }}>
                  <span className="tiny muted" style={{ letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    This over
                  </span>
                  {current.currentOver.length ? (
                    current.currentOver.map((b, i) => (
                      <span
                        key={i}
                        className={`ball ${b === 'W' ? 'W' : b === '4' ? 'four' : b === '6' ? 'six' : b.length > 1 ? 'extra' : ''}`}
                      >
                        {b}
                      </span>
                    ))
                  ) : (
                    <span className="tiny muted">New over</span>
                  )}
                </div>
              </div>
              <div className="sb-right">
                <div className="sb-line">
                  <span>At the crease</span>
                  <b>
                    {striker?.player?.name || '—'}* & {nonStriker?.player?.name || '—'}
                  </b>
                </div>
                <div className="sb-line">
                  <span>Bowler</span>
                  <b>{activeBowler?.player?.name || '—'}</b>
                </div>
                <div className="sb-line">
                  <span>Bowling side</span>
                  <b>{bowlingTeam?.short_name}</b>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="scoring">
        <div className="console">
          <div className="console-head">
            <span className="display" style={{ fontSize: 15, letterSpacing: '0.1em' }}>
              Scoring console
            </span>
            {busy ? <span className="tiny muted">Saving…</span> : null}
            <div className="right row" style={{ gap: 6 }}>
              {canScore && current && !current.closed ? (
                <>
                  <button type="button" className="btn btn-sm" onClick={undo} disabled={busy}>
                    Undo
                  </button>
                  {data.canDeclare ? (
                    <button type="button" className="btn btn-sm" onClick={declare} disabled={busy}>
                      Declare
                    </button>
                  ) : null}
                  {match.status === 'live' ? (
                    <button type="button" className="btn btn-sm btn-danger" onClick={abandon} disabled={busy}>
                      Abandon
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <div className="console-body">
            {!canScore ? (
              <div className="hint">Team accounts follow the match live. Scoring is done by the league administrator.</div>
            ) : null}

            {canScore && needsOpeners ? (
              <div className="prompt">
                <h4>Batters at the crease</h4>
                <div className="form-grid">
                  <div className="field">
                    <label>Striker</label>
                    <select
                      className="select"
                      value={openers.strikerId}
                      onChange={(e) => setOpeners({ ...openers, strikerId: e.target.value })}
                    >
                      <option value="">Choose batter</option>
                      {battingXi.map((p) => (
                        <option key={p.player_id} value={p.player_id}>
                          {xiNo(battingXi, p.player_id)}
                          {p.player_name} · {playerDetail(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Non-striker</label>
                    <select
                      className="select"
                      value={openers.nonStrikerId}
                      onChange={(e) => setOpeners({ ...openers, nonStrikerId: e.target.value })}
                    >
                      <option value="">Choose batter</option>
                      {battingXi
                        .filter((p) => String(p.player_id) !== String(openers.strikerId))
                        .map((p) => (
                          <option key={p.player_id} value={p.player_id}>
                            {xiNo(battingXi, p.player_id)}
                            {p.player_name} · {playerDetail(p)}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Opening bowler</label>
                    <select
                      className="select"
                      value={openers.bowlerId}
                      onChange={(e) => setOpeners({ ...openers, bowlerId: e.target.value })}
                    >
                      <option value="">Choose bowler</option>
                      <optgroup label="Bowlers & all-rounders">
                        {frontlineBowlers.map((p) => (
                          <option key={p.player_id} value={p.player_id}>
                            {p.player_name} · {playerDetail(p)}
                          </option>
                        ))}
                      </optgroup>
                      {partTimeBowlers.length ? (
                        <optgroup label="Others in the XI">
                          {partTimeBowlers.map((p) => (
                            <option key={p.player_id} value={p.player_id}>
                              {p.player_name} · {playerDetail(p)}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                  </div>
                  <div className="field" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={submitOpeners}
                      disabled={!openers.strikerId || !openers.nonStrikerId || !openers.bowlerId || busy}
                    >
                      Start innings
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {canScore && needsBatter && !needsOpeners ? (
              <div className="prompt">
                <h4>Next batter in</h4>
                <div className="pick-grid">
                  {availableBatters.map((p) => (
                    <button
                      key={p.player_id}
                      type="button"
                      className="pick stack"
                      onClick={() => act('/batter', { inningsId: current.inningsId, playerId: p.player_id })}
                      disabled={busy}
                    >
                      <span className="pick-no">{xiNo(battingXi, p.player_id).replace('. ', '')}</span>
                      <span>{p.player_name}</span>
                      <span className="role">{playerDetail(p)}</span>
                    </button>
                  ))}
                  {!availableBatters.length ? <span className="small muted">No batters left.</span> : null}
                </div>
              </div>
            ) : null}

            {canScore && current && !current.closed && current.needsNewBowler && !needsOpeners ? (
              <div className="prompt">
                <h4>Choose the bowler for the next over</h4>
                <div className="pick-grid">
                  {frontlineBowlers.map((p) => (
                    <button
                      key={p.player_id}
                      type="button"
                      className="pick stack"
                      onClick={() => act('/bowler', { inningsId: current.inningsId, playerId: p.player_id })}
                      disabled={busy}
                    >
                      <span>{p.player_name}</span>
                      <span className="role">{playerDetail(p)}</span>
                    </button>
                  ))}
                </div>
                {partTimeBowlers.length ? (
                  <>
                    <div className="tiny muted" style={{ letterSpacing: '0.08em', margin: '12px 0 6px' }}>
                      OTHERS IN THE XI · CAN BOWL IF NEEDED
                    </div>
                    <div className="pick-grid">
                      {partTimeBowlers.map((p) => (
                        <button
                          key={p.player_id}
                          type="button"
                          className="pick stack"
                          onClick={() => act('/bowler', { inningsId: current.inningsId, playerId: p.player_id })}
                          disabled={busy}
                        >
                          <span>{p.player_name}</span>
                          <span className="role">{playerDetail(p)}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {canScore && current && !current.closed && current.freeHit ? (
              <div className="free-hit">
                <strong>Free hit</strong>
                <span>
                  Only a run out or obstruction can dismiss the batter. Score it like any other ball — the free hit ends
                  after this delivery unless it is a wide or a no-ball.
                </span>
              </div>
            ) : null}

            {canScore && current && !current.closed ? (
              <>
                <div className="run-grid">
                  {[0, 1, 2, 3].map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="run-btn"
                      disabled={busy || current.needsNewBatter || !current.strikerId || !current.bowlerId}
                      onClick={() => scoreBall({ runs: r })}
                    >
                      {r}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="run-btn four"
                    disabled={busy || current.needsNewBatter || !current.strikerId || !current.bowlerId}
                    onClick={() => scoreBall({ runs: 4 })}
                  >
                    4
                  </button>
                  <button
                    type="button"
                    className="run-btn six"
                    disabled={busy || current.needsNewBatter || !current.strikerId || !current.bowlerId}
                    onClick={() => scoreBall({ runs: 6 })}
                  >
                    6
                  </button>
                  <button
                    type="button"
                    className="run-btn wicket"
                    disabled={busy || current.needsNewBatter || !current.strikerId || !current.bowlerId}
                    onClick={() => {
                      setWicket({
                        type: current.freeHit ? 'run out' : 'bowled',
                        dismissedId: String(current.strikerId),
                        fielderId: '',
                        noBall: false,
                      });
                      setWicketOpen(true);
                    }}
                  >
                    Wicket
                  </button>
                </div>

                <div className="extra-grid">
                  {[
                    ['wd', 'Wide'],
                    ['nb', 'No ball'],
                    ['b', 'Bye'],
                    ['lb', 'Leg bye'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`extra-btn ${extraPick === key ? 'on' : ''}`}
                      onClick={() => setExtraPick(extraPick === key ? null : key)}
                      disabled={busy || current.needsNewBatter || !current.strikerId || !current.bowlerId}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {extraPick === 'nb' ? (
                  <div className="nb-panel">
                    <div className="tiny muted" style={{ letterSpacing: '0.08em', marginBottom: 8 }}>
                      NO BALL · 1 PENALTY RUN IS AUTOMATIC · RUNS OFF THE BAT
                    </div>
                    <div className="run-grid">
                      {[0, 1, 2, 3, 4, 6].map((r) => (
                        <button
                          key={r}
                          type="button"
                          className="run-btn"
                          disabled={busy}
                          onClick={async () => {
                            const ok = await scoreBall({ runs: r, extraType: 'nb', extraRuns: 1 });
                            if (ok) setExtraPick(null);
                          }}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                    <div className="row wrap" style={{ marginTop: 10, alignItems: 'center' }}>
                      <span className="tiny muted">No bat runs, extra runs (byes / overthrows):</span>
                      {[2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={async () => {
                            const ok = await scoreBall({ runs: 0, extraType: 'nb', extraRuns: n });
                            if (ok) setExtraPick(null);
                          }}
                        >
                          {n}
                        </button>
                      ))}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExtraPick(null)}>
                        Cancel
                      </button>
                    </div>
                    <div className="hint" style={{ marginTop: 8 }}>
                      The next delivery is a free hit. No-ball runs are charged to the bowler and the delivery is not
                      counted in the over.
                    </div>
                  </div>
                ) : extraPick ? (
                  <div className="row wrap" style={{ marginTop: 10, alignItems: 'center' }}>
                    <span className="tiny muted">
                      {extraPick === 'wd' ? 'Wide +' : extraPick === 'b' ? 'Byes +' : 'Leg byes +'} runs:
                    </span>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await scoreBall({ runs: 0, extraType: extraPick, extraRuns: n });
                          if (ok) setExtraPick(null);
                        }}
                      >
                        {n}
                      </button>
                    ))}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExtraPick(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null}

                <div className="hint" style={{ marginTop: 12 }}>
                  Balls are appended to the delivery log, so undo always rewinds cleanly.
                </div>
              </>
            ) : null}

            {current?.closed ? (
              <div className="hint">
                This innings is closed.{' '}
                {current.inningsNo < match.innings_limit ? 'Set the openers for the next innings.' : ''}
              </div>
            ) : null}
          </div>
        </div>

        <div className="stack" style={{ gap: 18 }}>
          <div className="panel">
            <div className="panel-head">
              <h3>At the crease</h3>
              <span className="right tiny muted">{battingTeam?.short_name}</span>
            </div>
            <div className="panel-body">
              {[striker, nonStriker].filter(Boolean).map((b) => (
                <div className="batter-row" key={b.playerId}>
                  <div className="n">
                    {b.player?.name}
                    {b.playerId === current?.strikerId ? <i>*</i> : null}
                  </div>
                  <div className="right num">{b.runs}</div>
                  <div className="right num">{b.balls}</div>
                  <div className="right num">{b.fours}</div>
                  <div className="right num">{b.sixes}</div>
                  <div className="right num">{b.balls ? ((b.runs / b.balls) * 100).toFixed(0) : '0'}</div>
                </div>
              ))}
              {!striker && !nonStriker ? <span className="small muted">No batters at the crease yet.</span> : null}
              <div className="tiny muted" style={{ marginTop: 10, letterSpacing: '0.08em' }}>
                BATTER · R · B · 4s · 6s · SR
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Bowling</h3>
              <span className="right tiny muted">{bowlingTeam?.short_name}</span>
            </div>
            <div className="panel-body flush">
              <table className="sheet compact">
                <thead>
                  <tr>
                    <th>Bowler</th>
                    <th className="right">O</th>
                    <th className="right">M</th>
                    <th className="right">R</th>
                    <th className="right">W</th>
                  </tr>
                </thead>
                <tbody>
                  {(current?.bowling || []).map((b) => (
                    <tr key={b.playerId}>
                      <td>
                        {b.player?.name}
                        {b.playerId === current?.bowlerId ? (
                          <span className="badge wk" style={{ marginLeft: 6 }}>
                            ON
                          </span>
                        ) : null}
                      </td>
                      <td className="num">{overs(b.balls)}</td>
                      <td className="num">{b.maidens}</td>
                      <td className="num">{b.runs}</td>
                      <td className="num strong">{b.wickets}</td>
                    </tr>
                  ))}
                  {!current?.bowling?.length ? (
                    <tr>
                      <td colSpan={5} className="muted small">
                        No bowling yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {data.innings.length ? (
            <div className="panel">
              <div className="panel-head">
                <h3>Innings</h3>
              </div>
              <div className="panel-body">
                <div className="innings-strip">
                  {data.innings.map((inn) => (
                    <div className="innings-card" key={inn.id}>
                      <div className="t">{inn.battingTeam?.short_name}</div>
                      <div className="s">
                        {inn.runs}/{inn.wickets}
                      </div>
                      <div className="tiny muted">{inn.overs} ov</div>
                    </div>
                  ))}
                </div>
                {lastInnings?.target ? (
                  <div className="hint" style={{ marginTop: 8 }}>
                    Target {lastInnings.target}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {wicketOpen ? (
        <Modal
          title="Wicket"
          onClose={() => setWicketOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setWicketOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={submitWicket} disabled={busy}>
                Record wicket
              </button>
            </>
          }
        >
          <div className="form-grid">
            {current?.freeHit ? (
              <div className="free-hit full">
                <strong>Free hit</strong>
                <span>No bowler can take a wicket here — only a run out or obstruction is possible.</span>
              </div>
            ) : (
              <div className="field full">
                <label>Was this delivery a no-ball?</label>
                <div className="seg">
                  <button
                    type="button"
                    className={wicket.noBall ? '' : 'on'}
                    onClick={() => setWicket({ ...wicket, noBall: false })}
                  >
                    Fair delivery
                  </button>
                  <button
                    type="button"
                    className={wicket.noBall ? 'on' : ''}
                    onClick={() => setWicket({ ...wicket, noBall: true, type: 'run out' })}
                  >
                    No ball (+1 run)
                  </button>
                </div>
              </div>
            )}
            <div className="field full">
              <label>How out</label>
              <select
                className="select"
                value={(current?.freeHit || wicket.noBall ? FREE_HIT_WICKETS : WICKET_TYPES).includes(wicket.type)
                  ? wicket.type
                  : current?.freeHit || wicket.noBall
                    ? 'run out'
                    : 'bowled'}
                onChange={(e) => setWicket({ ...wicket, type: e.target.value })}
              >
                {(current?.freeHit || wicket.noBall ? FREE_HIT_WICKETS : WICKET_TYPES).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {current?.freeHit || wicket.noBall ? (
                <span className="sub">A no-ball or free hit cannot be bowled, caught, lbw or stumped.</span>
              ) : null}
            </div>
            <div className="field full">
              <label>Batter out</label>
              <div className="row wrap">
                {[
                  ['striker', current?.strikerId, striker?.player?.name],
                  ['non-striker', current?.nonStrikerId, nonStriker?.player?.name],
                ]
                  .filter(([, pid]) => pid)
                  .map(([label, pid, name]) => (
                    <label key={label} className={`pick ${Number(wicket.dismissedId) === Number(pid) ? 'on' : ''}`}>
                      <input
                        type="radio"
                        name="dismissed"
                        checked={Number(wicket.dismissedId) === Number(pid)}
                        onChange={() => setWicket({ ...wicket, dismissedId: String(pid) })}
                      />
                      {name} <span className="role">{label}</span>
                    </label>
                  ))}
              </div>
            </div>
            {['caught', 'stumped', 'run out', 'caught and bowled'].includes(wicket.type) ? (
              <div className="field full">
                <label>Fielder / keeper (optional)</label>
                <select
                  className="select"
                  value={wicket.fielderId}
                  onChange={(e) => setWicket({ ...wicket, fielderId: e.target.value })}
                >
                  <option value="">Not recorded</option>
                  {bowlingXi.map((p) => (
                    <option key={p.player_id} value={p.player_id}>
                      {p.player_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="hint full">
              After the wicket the new batter is prompted. Run outs are not credited to the bowler, and a no-ball adds
              one penalty run to the total.
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
