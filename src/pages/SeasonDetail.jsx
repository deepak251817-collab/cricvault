import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, downloadFile } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import {
  Crest,
  Empty,
  Modal,
  RoleBadge,
  Spinner,
  StatusBadge,
  Tabs,
  formatDate,
} from '../ui.jsx';
import { FixturesTab, PlayoffsTab, SquadsTab } from './SeasonOps.jsx';

function Award({ label, name, value }) {
  return (
    <div className="award">
      <div className="trophy">{label.toLowerCase().includes('run') ? 'Bat' : 'Ball'}</div>
      <div style={{ minWidth: 0 }}>
        <div className="k">{label}</div>
        <div className="name">{name || 'Not decided'}</div>
        <div className="v">{value || 'Scores will decide this award'}</div>
      </div>
    </div>
  );
}

function EditSeason({ season, teams, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: season.name,
    status: season.status,
    playoffTeams: season.playoff_teams || 4,
    startsOn: season.starts_on || '',
    notes: season.notes || '',
    winnerTeamId: season.winner_team_id || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/seasons/${season.id}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          status: form.status,
          playoffTeams: Number(form.playoffTeams),
          startsOn: form.startsOn || null,
          notes: form.notes,
          winnerTeamId: form.winnerTeamId ? Number(form.winnerTeamId) : null,
        },
      });
      toast('Season updated');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit season"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-season" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save season'}
          </button>
        </>
      }
    >
      <form id="edit-season" onSubmit={submit} className="form-grid">
        <div className="field full">
          <label>Season name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="field">
          <label>Status</label>
          <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="draft">Draft</option>
            <option value="fixtures">Fixtures published</option>
            <option value="live">In progress</option>
            <option value="playoffs">Playoffs</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div className="field">
          <label>Playoff format</label>
          <select
            className="select"
            value={form.playoffTeams}
            onChange={(e) => setForm({ ...form, playoffTeams: e.target.value })}
          >
            <option value={2}>Top 2</option>
            <option value={4}>Top 4 — IPL style</option>
            <option value={5}>Top 5</option>
          </select>
        </div>
        <div className="field">
          <label>Start date</label>
          <input
            className="input"
            type="date"
            value={form.startsOn}
            onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Champion (manual)</label>
          <select
            className="select"
            value={form.winnerTeamId}
            onChange={(e) => setForm({ ...form, winnerTeamId: e.target.value })}
          >
            <option value="">Not decided</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="hint">The playoff final sets this automatically.</span>
        </div>
        <div className="field full">
          <label>Notes</label>
          <textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error ? <div className="error-text full">{error}</div> : null}
      </form>
    </Modal>
  );
}

function PointsTab({ season, points }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Points table</h3>
        <span className="sub">IPL format · win 2 · tie / no result 1</span>
        <span className="right tiny muted">{season.playoff_teams ? `Top ${season.playoff_teams} qualify` : 'No playoffs'}</span>
      </div>
      <div className="panel-body flush">
        {points.length ? (
          <div className="table-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th className="right">P</th>
                  <th className="right">W</th>
                  <th className="right">L</th>
                  <th className="right">T</th>
                  <th className="right">NR</th>
                  <th className="right">Pts</th>
                  <th className="right">NRR</th>
                  <th>Form</th>
                </tr>
              </thead>
              <tbody>
                {points.map((row) => (
                  <tr key={row.teamId} className={row.qualified ? 'qualify' : ''}>
                    <td className="pos">{row.position}</td>
                    <td>
                      <div className="team-cell">
                        <Crest team={{ short_name: row.shortName, name: row.name, color: row.color }} size={24} />
                        <div>
                          <div className="strong">{row.name}</div>
                          <span className="sub">
                            {row.oversFor} ov for · {row.oversAgainst} ov against
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="num">{row.played}</td>
                    <td className="num">{row.won}</td>
                    <td className="num">{row.lost}</td>
                    <td className="num">{row.tied}</td>
                    <td className="num">{row.noResult}</td>
                    <td className="num strong">{row.points}</td>
                    <td className="num">{row.nrr > 0 ? `+${row.nrr.toFixed(3)}` : row.nrr.toFixed(3)}</td>
                    <td>
                      <div className="form-list">
                        {row.form.map((f, i) => (
                          <span key={`${f}-${i}`} className={f}>
                            {f}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matches played">Complete a league match and the table starts building.</Empty>
        )}
      </div>
      <div className="panel-foot">
        <span>NRR = runs per over scored minus runs per over conceded. An all-out side is charged its full over quota.</span>
      </div>
    </div>
  );
}

function StatsTab({ seasonId }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    api(`/stats/leaderboards?seasonId=${seasonId}&limit=100`)
      .then((d) => alive && setRows(d))
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
  }, [seasonId, toast]);

  if (!rows) return <Spinner label="Building leaderboards" />;

  return (
    <div className="grid cols-2">
      <div className="panel">
        <div className="panel-head">
          <h3>Batting</h3>
          <span className="sub">Runs · season</span>
        </div>
        <div className="panel-body flush">
          <div className="table-wrap">
            <table className="sheet compact">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="right">Inns</th>
                  <th className="right">Runs</th>
                  <th className="right">HS</th>
                  <th className="right">Avg</th>
                  <th className="right">SR</th>
                  <th className="right">50/100</th>
                </tr>
              </thead>
              <tbody>
                {rows.batting.map((b, i) => (
                  <tr key={b.playerId}>
                    <td>
                      <div className="row" style={{ gap: 7 }}>
                        <span className="pos">{i + 1}</span>
                        <Link to={`/players/${b.playerId}`} className="strong">
                          {b.name}
                        </Link>
                      </div>
                    </td>
                    <td className="num">{b.innings}</td>
                    <td className="num strong">{b.runs}</td>
                    <td className="num">{b.highScore}</td>
                    <td className="num">{b.average}</td>
                    <td className="num">{b.strikeRate}</td>
                    <td className="num">
                      {b.fifties}/{b.hundreds}
                    </td>
                  </tr>
                ))}
                {!rows.batting.length ? (
                  <tr>
                    <td colSpan={7}>
                      <Empty title="No runs yet" />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Bowling</h3>
          <span className="sub">Wickets · season</span>
        </div>
        <div className="panel-body flush">
          <div className="table-wrap">
            <table className="sheet compact">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="right">Inns</th>
                  <th className="right">Wkts</th>
                  <th className="right">Best</th>
                  <th className="right">Avg</th>
                  <th className="right">Econ</th>
                  <th className="right">5W</th>
                </tr>
              </thead>
              <tbody>
                {rows.bowling.map((b, i) => (
                  <tr key={b.playerId}>
                    <td>
                      <div className="row" style={{ gap: 7 }}>
                        <span className="pos">{i + 1}</span>
                        <Link to={`/players/${b.playerId}`} className="strong">
                          {b.name}
                        </Link>
                      </div>
                    </td>
                    <td className="num">{b.innings}</td>
                    <td className="num strong">{b.wickets}</td>
                    <td className="num">{b.best}</td>
                    <td className="num">{b.average ?? '—'}</td>
                    <td className="num">{b.economy ?? '—'}</td>
                    <td className="num">{b.fiveWicketHauls}</td>
                  </tr>
                ))}
                {!rows.bowling.length ? (
                  <tr>
                    <td colSpan={7}>
                      <Empty title="No wickets yet" />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SeasonDetail() {
  const { id } = useParams();
  const { user, refresh } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = () =>
    api(`/seasons/${id}`)
      .then(setData)
      .catch((err) => toast(err.message, 'error'));

  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canEdit = user.role === 'admin';

  if (!data) return <Spinner label="Opening the season" />;

  const { season, teams, points, matches } = data;
  const recent = matches.filter((m) => m.status === 'completed').slice(-5).reverse();

  const exportBackup = async () => {
    setExporting(true);
    try {
      const slug =
        season.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'season';
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadFile(`/seasons/${season.id}/export`, `cricvault-${slug}-${stamp}.json`);
      toast('Season backup downloaded — keep the .json file safe');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const removeSeason = async () => {
    const played = matches.filter((m) => m.status === 'completed' || m.status === 'live').length;
    const warning =
      `Delete “${season.name}” and everything in it?\n\n` +
      `This removes ${matches.length} fixture${matches.length === 1 ? '' : 's'}` +
      (played ? ` (${played} played)` : '') +
      ', the squads, every ball bowled and all results.\n\n' +
      'It cannot be undone — export a backup first if you may want the season back.';
    if (!window.confirm(warning)) return;
    try {
      const res = await api(`/seasons/${season.id}`, { method: 'DELETE' });
      toast(`Season deleted — ${res.matches} fixture(s) and ${res.deliveries} ball(s) removed`);
      refresh();
      navigate('/seasons');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'points', label: 'Points table', count: points.length },
    { key: 'fixtures', label: 'Fixtures', count: matches.length },
    { key: 'squads', label: 'Squads' },
    { key: 'stats', label: 'Stats' },
    { key: 'playoffs', label: 'Playoffs' },
  ];

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">
            <Link to="/seasons">Seasons</Link> / {season.formatLabel}
          </div>
          <h1>{season.name}</h1>
          <div className="row wrap" style={{ marginTop: 8, gap: 7 }}>
            <StatusBadge status={season.status} />
            <span className="badge role">{season.formatLabel}</span>
            <span className="badge role">{data.teamCount} teams</span>
            <span className="badge role">{data.leagueMatches} league matches</span>
            {season.playoff_teams ? <span className="badge role">Top {season.playoff_teams} playoffs</span> : null}
          </div>
        </div>
        {canEdit ? (
          <div className="page-actions">
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit season
            </button>
            <button type="button" className="btn" onClick={exportBackup} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export backup'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={removeSeason}>
              Delete
            </button>
          </div>
        ) : null}
      </div>

      {data.winner ? (
        <div className="hero-live" style={{ marginBottom: 18 }}>
          <div className="inner">
            <div className="sb-top">
              <span>Season complete</span>
              <span>·</span>
              <span>{season.name}</span>
            </div>
            <div className="sb-grid">
              <div>
                <div className="sb-team">
                  <Crest team={data.winner} size={26} />
                  {data.winner.name}
                </div>
                <div className="sb-score" style={{ fontSize: 32, letterSpacing: '0.05em' }}>
                  CHAMPIONS
                </div>
              </div>
              <div className="sb-right">
                <div className="sb-line">
                  <span>Runner-up</span>
                  <b>{data.runnerUp?.name || '—'}</b>
                </div>
                <div className="sb-line">
                  <span>Most runs</span>
                  <b>{data.awards.mostRuns?.name || '—'}</b>
                </div>
                <div className="sb-line">
                  <span>Most wickets</span>
                  <b>{data.awards.mostWickets?.name || '—'}</b>
                </div>
                <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={() => setTab('playoffs')}>
                  View playoff bracket
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' ? (
        <>
          <div className="awards">
            <Award
              label="Most runs award"
              name={data.awards.mostRuns?.name}
              value={
                data.awards.mostRuns
                  ? `${data.awards.mostRuns.runs} runs · HS ${data.awards.mostRuns.highScore} · ${data.awards.mostRuns.innings} innings`
                  : ''
              }
            />
            <Award
              label="Most wickets award"
              name={data.awards.mostWickets?.name}
              value={
                data.awards.mostWickets
                  ? `${data.awards.mostWickets.wickets} wickets · Best ${data.awards.mostWickets.best} · Econ ${data.awards.mostWickets.economy}`
                  : ''
              }
            />
          </div>

          <div className="grid cols-2" style={{ marginTop: 18 }}>
            <div className="panel">
              <div className="panel-head">
                <h3>Run scorers</h3>
                <span className="right tiny muted">Top 5</span>
              </div>
              <div className="panel-body flush">
                <table className="sheet compact">
                  <tbody>
                    {data.stats.batting.map((b, i) => (
                      <tr key={b.playerId}>
                        <td style={{ width: 30 }} className="pos">
                          {i + 1}
                        </td>
                        <td>
                          <Link to={`/players/${b.playerId}`} className="strong">
                            {b.name}
                          </Link>
                          <span className="sub">
                            {b.innings} inns · HS {b.highScore} · SR {b.strikeRate}
                          </span>
                        </td>
                        <td className="right">
                          <span className="display" style={{ fontSize: 22 }}>
                            {b.runs}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!data.stats.batting.length ? (
                      <tr>
                        <td colSpan={3}>
                          <Empty title="No runs yet" />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h3>Wicket takers</h3>
                <span className="right tiny muted">Top 5</span>
              </div>
              <div className="panel-body flush">
                <table className="sheet compact">
                  <tbody>
                    {data.stats.bowling.map((b, i) => (
                      <tr key={b.playerId}>
                        <td style={{ width: 30 }} className="pos">
                          {i + 1}
                        </td>
                        <td>
                          <Link to={`/players/${b.playerId}`} className="strong">
                            {b.name}
                          </Link>
                          <span className="sub">
                            Best {b.best} · Econ {b.economy ?? '—'}
                          </span>
                        </td>
                        <td className="right">
                          <span className="display" style={{ fontSize: 22 }}>
                            {b.wickets}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!data.stats.bowling.length ? (
                      <tr>
                        <td colSpan={3}>
                          <Empty title="No wickets yet" />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid side" style={{ marginTop: 18 }}>
            <div className="panel">
              <div className="panel-head">
                <h3>Recent results</h3>
                <button type="button" className="right btn btn-ghost btn-sm" onClick={() => setTab('fixtures')}>
                  Fixtures →
                </button>
              </div>
              <div className="panel-body flush">
                {recent.length ? (
                  <table className="sheet compact">
                    <tbody>
                      {recent.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <Link to={`/matches/${m.id}/scorecard`} className="strong">
                              {m.team_a_short} v {m.team_b_short}
                            </Link>
                            <span className="sub">{m.result_text}</span>
                          </td>
                          <td className="right tiny muted">{formatDate(m.completed_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <Empty title="No results yet" />
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h3>Season facts</h3>
              </div>
              <div className="panel-body">
                <table className="sheet compact">
                  <tbody>
                    <tr>
                      <td className="strong">Format</td>
                      <td className="right">{season.formatLabel}</td>
                    </tr>
                    <tr>
                      <td className="strong">Overs</td>
                      <td className="right">{season.overs_per_innings ?? 'Unlimited'}</td>
                    </tr>
                    <tr>
                      <td className="strong">Innings</td>
                      <td className="right">{season.innings_limit}</td>
                    </tr>
                    <tr>
                      <td className="strong">Playoffs</td>
                      <td className="right">Top {season.playoff_teams || '—'}</td>
                    </tr>
                    <tr>
                      <td className="strong">Starts</td>
                      <td className="right">{season.starts_on ? formatDate(season.starts_on) : 'TBC'}</td>
                    </tr>
                    <tr>
                      <td className="strong">Matches played</td>
                      <td className="right">
                        {matches.filter((m) => m.status === 'completed').length} / {matches.length}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {season.notes ? (
                  <p className="small muted" style={{ marginTop: 12 }}>
                    {season.notes}
                  </p>
                ) : null}
                <p className="tiny muted" style={{ marginTop: 12 }}>
                  <strong>Export backup</strong> saves this season — squads, fixtures, every ball and the result — as one
                  .json file. Restore it from the Seasons page to rebuild the season exactly as it stands.
                </p>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'points' ? <PointsTab season={season} points={points} /> : null}
      {tab === 'fixtures' ? (
        <FixturesTab season={season} matches={matches} teams={teams} canEdit={canEdit} onChanged={load} />
      ) : null}
      {tab === 'squads' ? (
        <SquadsTab season={season} teams={teams} squads={data.squads} canEdit={canEdit} onChanged={load} />
      ) : null}
      {tab === 'stats' ? <StatsTab seasonId={season.id} /> : null}
      {tab === 'playoffs' ? <PlayoffsTab data={data} canEdit={canEdit} onChanged={load} /> : null}

      {editing ? (
        <EditSeason
          season={season}
          teams={teams}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
            refresh();
          }}
        />
      ) : null}
    </>
  );
}
