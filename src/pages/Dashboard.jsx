import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import { Crest, Stat, StatusBadge, Empty, Spinner, formatDateTime } from '../ui.jsx';

function inningsScore(inn) {
  if (!inn) return '—';
  return `${inn.runs}/${inn.wickets}`;
}

function LiveHero({ match, onScore }) {
  const scripts = match.summary || [];
  const current = scripts[scripts.length - 1];
  return (
    <div className="hero-live">
      <div className="inner">
        <div className="sb-top">
          <span>{match.season_name}</span>
          <span>·</span>
          <span>{match.stage === 'playoff' ? match.stage_name || 'Playoff' : 'League match'}</span>
          <StatusBadge status="live" />
        </div>
        <div className="sb-grid">
          <div>
            <div className="sb-team">
              <Crest
                team={{ short_name: match.team_a_short, name: match.team_a_name, color: match.team_a_color }}
                size={24}
              />
              {match.team_a_name}
            </div>
            <div className="sb-score">
              {scripts.map((inn, index) => (
                <span key={inn.id} style={{ marginRight: 18 }}>
                  {inningsScore(inn)}
                  <span className="ov">
                    {index === scripts.length - 1 ? `${inn.overs} ov` : ''}
                  </span>
                </span>
              ))}
              {!scripts.length ? '—' : null}
            </div>
            <div className="sb-meta">
              <span>
                vs <b>{match.team_b_name}</b>
              </span>
              {current?.target ? (
                <span>
                  Target <b>{current.target}</b>
                </span>
              ) : null}
              {match.venue ? <span>{match.venue}</span> : null}
            </div>
          </div>
          <div className="sb-right">
            <div className="sb-line">
              <span>Chasing side</span>
              <b>{current?.battingTeam?.name || '—'}</b>
            </div>
            <div className="sb-line">
              <span>Run rate</span>
              <b>
                {current && current.balls ? (current.runs / (current.balls / 6)).toFixed(2) : '—'}
              </b>
            </div>
            <div className="sb-line">
              <span>Innings</span>
              <b>
                {scripts.length} of {match.innings_limit}
              </b>
            </div>
            <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={onScore}>
              Open scoring console
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { refresh } = useApp();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [seasonId, setSeasonId] = useState('');

  useEffect(() => {
    let alive = true;
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : '';
    api(`/stats/overview${query}`)
      .then((d) => alive && setData(d))
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
  }, [seasonId, toast]);

  if (!data) return <Spinner label="Reading the scorebook" />;

  const live = data.liveMatches?.[0];
  const season = data.selectedSeason;
  const allSeasons = season?.id === 'all';
  const seasonHref = season && season.id !== 'all' ? `/seasons/${season.id}` : '/seasons';
  const seasonScope = season ? season.name : 'No season';

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">League command centre</div>
          <h1>Dashboard</h1>
          <div className="sub">
            {data.counts.teams} teams · {data.counts.players} players · {data.counts.seasons} seasons ·{' '}
            {data.counts.matches} matches on the books
          </div>
        </div>
        <div className="page-actions">
          <label className="row" style={{ gap: 8 }}>
            <span className="tiny muted" style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Season
            </span>
            <select
              className="select"
              style={{ minWidth: 200 }}
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
            >
              <option value="">
                {data.activeSeason ? `Current — ${data.activeSeason.name}` : 'Current season'}
              </option>
              {(data.seasons || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="all">All seasons — career totals</option>
            </select>
          </label>
          <Link className="btn" to="/seasons">
            Seasons
          </Link>
          <Link className="btn btn-dark" to="/matches">
            Fixtures & scores
          </Link>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 18 }}>
        <Stat label="Teams" value={data.counts.teams} detail="Registered franchises" />
        <Stat label="Players" value={data.counts.players} detail="Active cricketers" />
        <Stat label="Seasons" value={data.counts.seasons} detail={`${data.champions.length} champions crowned`} />
        <Stat
          label="Matches"
          value={data.counts.matches}
          detail={`${data.counts.completed} completed · ${data.counts.live} live`}
        />
      </div>

      {live ? (
        <LiveHero match={live} onScore={() => (window.location.href = `/matches/${live.id}`)} />
      ) : (
        <div className="hero-live">
          <div className="inner">
            <div className="sb-top">
              <span>{season ? season.formatLabel : 'No season yet'}</span>
              <span>·</span>
              <span>{season ? season.name : 'Pre-season'}</span>
              {season && season.status ? <StatusBadge status={season.status} /> : null}
            </div>
            <div className="sb-grid">
              <div>
                <div className="sb-team">{season ? season.name : 'Start your league'}</div>
                <div className="sb-score" style={{ fontSize: 34, letterSpacing: '0.05em' }}>
                  {live ? 'LIVE NOW' : season ? 'SEASON IN PLAY' : 'NO SEASON IN PLAY'}
                </div>
                <div className="sb-meta">
                  <span>
                    <b>{data.seasonTotals.runs}</b> runs scored
                  </span>
                  <span>
                    <b>{data.seasonTotals.wickets}</b> wickets taken
                  </span>
                  <span>{data.counts.completed} matches completed</span>
                </div>
              </div>
              <div className="sb-right">
                {data.standings.slice(0, 3).map((row) => (
                  <div className="sb-line" key={row.teamId}>
                    <span>{row.name}</span>
                    <b>
                      {row.points} pts
                    </b>
                  </div>
                ))}
                {!data.standings.length ? <div className="sb-line">No table yet</div> : null}
                <Link className="btn btn-primary btn-block" style={{ marginTop: 12 }} to={seasonHref}>
                  {allSeasons ? 'Browse seasons' : season ? 'Open season' : 'Create a season'}
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Most runs</h3>
            <span className="sub">{seasonScope}</span>
            <span className="right tiny muted">Top 5</span>
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
                    <th className="right">SR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.seasonLeaders.batting.map((row, i) => (
                    <tr key={row.playerId}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="pos">{String(i + 1).padStart(2, '0')}</span>
                          <Link to={`/players/${row.playerId}`} className="strong">
                            {row.name}
                          </Link>
                        </div>
                      </td>
                      <td className="num">{row.innings}</td>
                      <td className="num strong">{row.runs}</td>
                      <td className="num">{row.highScore}</td>
                      <td className="num">{row.strikeRate?.toFixed?.(1) ?? row.strikeRate}</td>
                    </tr>
                  ))}
                  {!data.seasonLeaders.batting.length ? (
                    <tr>
                      <td colSpan={5}>
                        <Empty title="No runs yet">Score a match to start the race.</Empty>
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
            <h3>Most wickets</h3>
            <span className="sub">{seasonScope}</span>
            <span className="right tiny muted">Top 5</span>
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
                    <th className="right">Econ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.seasonLeaders.bowling.map((row, i) => (
                    <tr key={row.playerId}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="pos">{String(i + 1).padStart(2, '0')}</span>
                          <Link to={`/players/${row.playerId}`} className="strong">
                            {row.name}
                          </Link>
                        </div>
                      </td>
                      <td className="num">{row.innings}</td>
                      <td className="num strong">{row.wickets}</td>
                      <td className="num">{row.best}</td>
                      <td className="num">{row.economy ?? '—'}</td>
                    </tr>
                  ))}
                  {!data.seasonLeaders.bowling.length ? (
                    <tr>
                      <td colSpan={5}>
                        <Empty title="No wickets yet">The first spell is waiting.</Empty>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="grid side" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>{allSeasons ? 'All-seasons standings' : 'Points table'}</h3>
            <span className="sub">{seasonScope}</span>
            <Link to={allSeasons ? '/records' : seasonHref} className="right btn btn-ghost btn-sm">
              {allSeasons ? 'Records →' : 'Full table →'}
            </Link>
          </div>
          <div className="panel-body flush">
            {data.standings.length ? (
              <div className="table-wrap">
                <table className="sheet compact">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Team</th>
                      {allSeasons ? <th className="right">S</th> : null}
                      <th className="right">P</th>
                      <th className="right">W</th>
                      <th className="right">L</th>
                      <th className="right">Pts</th>
                      <th className="right">NRR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.standings.map((row, i) => (
                      <tr key={row.teamId} className={row.qualified ? 'qualify' : ''}>
                        <td className="pos">{row.position ?? i + 1}</td>
                        <td>
                          <div className="team-cell">
                            <Crest team={{ short_name: row.shortName, name: row.name, color: row.color }} size={22} />
                            <span className="strong">{row.name}</span>
                          </div>
                        </td>
                        {allSeasons ? <td className="num muted">{row.seasons}</td> : null}
                        <td className="num">{row.played}</td>
                        <td className="num">{row.won}</td>
                        <td className="num">{row.lost}</td>
                        <td className="num strong">{row.points}</td>
                        <td className="num">{row.nrr > 0 ? `+${row.nrr.toFixed(3)}` : row.nrr.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No table yet">Generate fixtures and the IPL-style table builds itself.</Empty>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Champion board</h3>
            <span className="right tiny muted">All seasons</span>
          </div>
          <div className="panel-body flush">
            {data.champions.length ? (
              <table className="sheet compact">
                <tbody>
                  {data.champions.map((t) => (
                    <tr key={t.id}>
                      <td style={{ width: 36 }}>
                        <Crest team={{ short_name: t.short_name, name: t.name, color: t.color }} size={26} />
                      </td>
                      <td>
                        <div className="strong">{t.name}</div>
                        <span className="sub">{t.last_title_season ? `Latest: season #${t.last_title_season}` : ''}</span>
                      </td>
                      <td className="right">
                        <span className="display" style={{ fontSize: 22, color: 'var(--amber-deep)' }}>
                          {t.titles}
                        </span>
                        <span className="sub">title{t.titles === 1 ? '' : 's'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="No champions yet">Finish a season and the trophy finds a home.</Empty>
            )}
          </div>
          <div className="panel-foot">
            <span>
              All-time runs <b style={{ color: 'var(--ink)' }}>{data.records.mostRuns?.runs ?? 0}</b>
              {data.records.mostRuns ? ` · ${data.records.mostRuns.name}` : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Next up</h3>
            <Link to="/matches" className="right btn btn-ghost btn-sm">
              All fixtures →
            </Link>
          </div>
          <div className="panel-body flush">
            {data.upcoming.length ? (
              <table className="sheet compact">
                <tbody>
                  {data.upcoming.map((m) => (
                    <tr key={m.id}>
                      <td style={{ width: 96 }}>
                        <span className="tiny muted">{formatDateTime(m.scheduled_at)}</span>
                      </td>
                      <td>
                        <Link to={`/matches/${m.id}`} className="strong">
                          {m.team_a_short} <span className="muted" style={{ fontWeight: 400 }}>v</span> {m.team_b_short}
                        </Link>
                        <span className="sub">{m.season_name}{m.venue ? ` · ${m.venue}` : ''}</span>
                      </td>
                      <td className="right">
                        <StatusBadge status={m.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="Nothing scheduled">Create a season and generate fixtures.</Empty>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Latest results</h3>
            <Link to="/matches" className="right btn btn-ghost btn-sm">
              Results →
            </Link>
          </div>
          <div className="panel-body flush">
            {data.recent.length ? (
              <table className="sheet compact">
                <tbody>
                  {data.recent.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link to={`/matches/${m.id}/scorecard`} className="strong">
                          {m.team_a_short} v {m.team_b_short}
                        </Link>
                        <span className="sub">{m.result_text || 'Completed'}</span>
                      </td>
                      <td className="right">
                        <span className="tiny muted">{m.season_name}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="No results yet">The first ball is still to come.</Empty>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
