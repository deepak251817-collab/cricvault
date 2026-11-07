import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import { Crest, Empty, RoleBadge, Spinner, formatDate, formatDateTime } from '../ui.jsx';

export default function TeamPage({ teamIdOverride = null, portal = false }) {
  const params = useParams();
  const { user } = useApp();
  const toast = useToast();
  const teamId = teamIdOverride || Number(params.id);
  const [meta, setMeta] = useState(null);
  const [seasonId, setSeasonId] = useState('');
  const [data, setData] = useState(null);
  const [seasonRows, setSeasonRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setMeta(null);
    api(`/teams/${teamId}`)
      .then((d) => alive && setMeta(d))
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
  }, [teamId, toast]);

  useEffect(() => {
    let alive = true;
    api(`/teams/${teamId}/seasons`)
      .then((rows) => alive && setSeasonRows(rows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [teamId]);

  useEffect(() => {
    if (!meta) return undefined;
    let alive = true;
    setLoading(true);
    const sid = seasonId || meta.seasons[0]?.id;
    const query = sid ? `?seasonId=${sid}` : '';
    api(`/teams/${teamId}/analytics${query}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        toast(err.message, 'error');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [meta, seasonId, teamId, toast]);

  if (user.role === 'team' && Number(user.team_id) !== Number(teamId)) {
    return <Navigate to="/team" replace />;
  }
  if (!meta) return <Spinner label="Loading team" />;

  const maxImpact = data?.players?.reduce((m, p) => Math.max(m, p.impact), 0) || 1;

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">{portal ? 'Team portal' : <><Link to="/teams">Teams</Link> / squad</>}</div>
          <div className="row" style={{ gap: 12, marginTop: 4 }}>
            <Crest team={meta.team} size={46} />
            <h1 style={{ margin: 0 }}>{meta.team.name}</h1>
          </div>
          <div className="sub">
            {meta.team.short_name}
            {meta.team.home_ground ? ` · ${meta.team.home_ground}` : ''} · {meta.titles.length} title
            {meta.titles.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="page-actions">
          {meta.seasons.length ? (
            <select
              className="select"
              style={{ width: 230 }}
              value={seasonId || meta.seasons[0].id}
              onChange={(e) => setSeasonId(e.target.value)}
            >
              {meta.seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="all">All seasons — career totals</option>
            </select>
          ) : null}
          {!portal ? (
            <Link className="btn" to="/teams">
              All teams
            </Link>
          ) : null}
        </div>
      </div>

      {!meta.seasons.length ? (
        <div className="panel">
          <Empty title="No season yet">This team has not been enrolled in a season.</Empty>
        </div>
      ) : loading || !data ? (
        <Spinner label="Tallying the season" />
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 18 }}>
            <div className="stat">
              <div className="k">Matches</div>
              <div className="v">{data.record.played}</div>
              <div className="d">{data.season?.name}</div>
            </div>
            <div className="stat">
              <div className="k">Won</div>
              <div className="v" style={{ color: 'var(--green)' }}>
                {data.record.won}
              </div>
              <div className="d">
                {data.record.played ? `${Math.round((data.record.won / data.record.played) * 100)}% win rate` : 'No matches'}
              </div>
            </div>
            <div className="stat">
              <div className="k">Lost / other</div>
              <div className="v" style={{ color: 'var(--red)' }}>
                {data.record.lost}
                <small>{data.record.tied} drawn</small>
              </div>
              <div className="d">{data.record.titles} championship{data.record.titles === 1 ? '' : 's'}</div>
            </div>
            <div className="stat">
              <div className="k">Season output</div>
              <div className="v">
                {data.totals.runs}
                <small>runs</small>
              </div>
              <div className="d">
                {data.totals.wickets} wickets · {data.totals.catches} catches
              </div>
            </div>
          </div>

          {seasonRows.length > 1 ? (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head">
                <h3>Every season</h3>
                <span className="sub">{seasonRows.length} seasons played</span>
                <span className="right tiny muted">Tap a season to load it</span>
              </div>
              <div className="panel-body flush">
                <div className="table-wrap">
                  <table className="sheet compact">
                    <thead>
                      <tr>
                        <th>Season</th>
                        <th className="right">Squad</th>
                        <th className="right">P</th>
                        <th className="right">W</th>
                        <th className="right">L</th>
                        <th className="right">Pos</th>
                        <th className="right">Pts</th>
                        <th className="right">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasonRows.map((s) => {
                        const active = String(seasonId || meta.seasons[0]?.id) === String(s.id);
                        return (
                          <tr
                            key={s.id}
                            className={active ? 'qualify' : ''}
                            onClick={() => setSeasonId(String(s.id))}
                            style={{ cursor: 'pointer' }}
                          >
                            <td>
                              <span className="strong">{s.name}</span>
                              <span className="sub">
                                {s.format?.toUpperCase()}
                                {s.startsOn ? ` · from ${formatDate(s.startsOn)}` : ''}
                              </span>
                            </td>
                            <td className="num">{s.squad}</td>
                            <td className="num">{s.played}</td>
                            <td className="num">{s.won}</td>
                            <td className="num">{s.lost}</td>
                            <td className="num">{s.position ?? '—'}</td>
                            <td className="num strong">{s.points}</td>
                            <td className="right">
                              {s.champion ? (
                                <span className="badge win">Champions</span>
                              ) : (
                                <span className="tiny muted">{s.played ? `${s.won}-${s.lost}` : 'No results'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid cols-2" style={{ marginBottom: 18 }}>
            <div className="panel">
              <div className="panel-head">
                <h3>Leading run scorer</h3>
              </div>
              <div className="panel-body">
                {data.topScorer && data.topScorer.batting.runs ? (
                  <div className="row spread">
                    <div>
                      <Link to={`/players/${data.topScorer.player_id}`} className="display" style={{ fontSize: 24 }}>
                        {data.topScorer.name}
                      </Link>
                      <div className="hint">
                        {data.topScorer.batting.innings} innings · HS {data.topScorer.batting.highScore}
                      </div>
                    </div>
                    <div className="right">
                      <div className="display" style={{ fontSize: 40 }}>
                        {data.topScorer.batting.runs}
                      </div>
                      <div className="tiny muted">RUNS</div>
                    </div>
                  </div>
                ) : (
                  <span className="muted small">No runs recorded this season.</span>
                )}
              </div>
            </div>
            <div className="panel">
              <div className="panel-head">
                <h3>Leading wicket taker</h3>
              </div>
              <div className="panel-body">
                {data.topWicketTaker && data.topWicketTaker.bowling.wickets ? (
                  <div className="row spread">
                    <div>
                      <Link to={`/players/${data.topWicketTaker.player_id}`} className="display" style={{ fontSize: 24 }}>
                        {data.topWicketTaker.name}
                      </Link>
                      <div className="hint">
                        Best {data.topWicketTaker.bowling.best} · Econ {data.topWicketTaker.bowling.economy ?? '—'}
                      </div>
                    </div>
                    <div className="right">
                      <div className="display" style={{ fontSize: 40 }}>
                        {data.topWicketTaker.bowling.wickets}
                      </div>
                      <div className="tiny muted">WICKETS</div>
                    </div>
                  </div>
                ) : (
                  <span className="muted small">No wickets recorded this season.</span>
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Squad contribution</h3>
              <span className="sub">
                {data.players.length} players · impact = runs + 20 × wickets + 8 × catches + 6 × run outs
              </span>
            </div>
            <div className="panel-body flush">
              {data.players.length ? (
                <div className="table-wrap">
                  <table className="sheet">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Role</th>
                        <th className="right">Inns</th>
                        <th className="right">Runs</th>
                        <th className="right">HS</th>
                        <th className="right">Wkts</th>
                        <th className="right">Best</th>
                        <th className="right">Ct</th>
                        <th className="right">Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.players.map((p) => (
                        <tr key={p.player_id}>
                          <td>
                            <Link to={`/players/${p.player_id}`} className="strong">
                              {p.name}
                            </Link>
                            <div className="row" style={{ gap: 4, marginTop: 2 }}>
                              {p.is_captain ? <span className="badge capt">C</span> : null}
                              {p.is_wicketkeeper ? <span className="badge wk">WK</span> : null}
                            </div>
                          </td>
                          <td>
                            <RoleBadge role={p.role} />
                          </td>
                          <td className="num">{p.batting.innings}</td>
                          <td className="num strong">{p.batting.runs}</td>
                          <td className="num">{p.batting.highScore}</td>
                          <td className="num strong">{p.bowling.wickets}</td>
                          <td className="num">{p.bowling.best}</td>
                          <td className="num">{p.bowling.catches}</td>
                          <td className="right">
                            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 60,
                                  height: 4,
                                  background: 'var(--line)',
                                  borderRadius: 2,
                                  overflow: 'hidden',
                                }}
                              >
                                <span
                                  style={{
                                    display: 'block',
                                    height: '100%',
                                    width: `${Math.min(100, (p.impact / maxImpact) * 100)}%`,
                                    background: 'var(--amber-deep)',
                                  }}
                                />
                              </span>
                              <b className="num">{p.impact}</b>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No squad yet">The administrator has not picked this season's squad.</Empty>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Season results</h3>
            </div>
            <div className="panel-body flush">
              {data.matches.length ? (
                <table className="sheet compact">
                  <tbody>
                    {data.matches.map((m) => {
                      const opponentId = m.team_a_id === teamId ? m.team_b_id : m.team_a_id;
                      const opponent = m.team_a_id === teamId ? m.team_b_short : m.team_a_short;
                      const won = m.winner_team_id === teamId;
                      void opponentId;
                      return (
                        <tr key={m.id}>
                          <td style={{ width: 110 }} className="tiny muted">
                            {formatDateTime(m.scheduled_at)}
                          </td>
                          <td>
                            <div className="strong">vs {opponent || 'TBD'}</div>
                            <span className="sub">{m.result_text || 'No result'}</span>
                          </td>
                          <td className="right">
                            {m.winner_team_id ? (
                              <span className={`badge ${won ? 'win' : 'loss'}`}>{won ? 'Won' : 'Lost'}</span>
                            ) : (
                              <span className="badge tie">Tie / NR</span>
                            )}
                          </td>
                          <td className="right">
                            <Link className="btn btn-sm" to={`/matches/${m.id}/scorecard`}>
                              Card
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <Empty title="No completed matches" />
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
