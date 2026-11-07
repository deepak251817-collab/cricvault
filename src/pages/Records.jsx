import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../App.jsx';
import { Crest, Empty, Spinner } from '../ui.jsx';

export default function Records() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [seasonId, setSeasonId] = useState('');

  useEffect(() => {
    let alive = true;
    const query = seasonId ? `?seasonId=${seasonId}` : '';
    api(`/stats/records${query}`)
      .then((d) => alive && setData(d))
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
  }, [seasonId, toast]);

  if (!data) return <Spinner label="Opening the record book" />;

  const scope = seasonId ? data.allSeasons.find((s) => String(s.id) === String(seasonId))?.name || 'Season' : null;
  const awardRows = seasonId ? data.seasonAwards.filter((s) => String(s.id) === String(seasonId)) : data.seasonAwards;

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">{scope ? 'Season record book' : 'All-time record book'}</div>
          <h1>Records</h1>
          <div className="sub">
            {scope
              ? `Every record from ${scope} only. Switch back to career to compare across seasons.`
              : 'Career totals across every completed season. Nothing here resets when a new season begins.'}
          </div>
        </div>
        <div className="page-actions">
          <label className="field" style={{ minWidth: 240 }}>
            <span className="label">Season</span>
            <select className="select" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
              <option value="">All seasons — career totals</option>
              {data.allSeasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status === 'completed' ? '' : ` (${s.status})`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="awards" style={{ marginBottom: 18 }}>
        <div className="award">
          <div className="trophy">Bat</div>
          <div style={{ minWidth: 0 }}>
            <div className="k">Most runs · {scope || 'all seasons'}</div>
            <div className="name">{data.mostRuns?.name || 'No runs yet'}</div>
            <div className="v">
              {data.mostRuns
                ? `${data.mostRuns.runs} runs · ${data.mostRuns.innings} inns · HS ${data.mostRuns.highScore} · SR ${data.mostRuns.strikeRate}`
                : 'Score a match to begin'}
            </div>
          </div>
        </div>
        <div className="award">
          <div className="trophy">Ball</div>
          <div style={{ minWidth: 0 }}>
            <div className="k">Most wickets · {scope || 'all seasons'}</div>
            <div className="name">{data.mostWickets?.name || 'No wickets yet'}</div>
            <div className="v">
              {data.mostWickets
                ? `${data.mostWickets.wickets} wickets · ${data.mostWickets.innings} inns · Best ${data.mostWickets.best}`
                : 'The first spell awaits'}
            </div>
          </div>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="k">Total runs</div>
          <div className="v">{data.totalRuns.toLocaleString()}</div>
          <div className="d">{scope || 'Across all seasons'}</div>
        </div>
        <div className="stat">
          <div className="k">Total wickets</div>
          <div className="v">{data.totalWickets.toLocaleString()}</div>
          <div className="d">Bowlers credited</div>
        </div>
        <div className="stat">
          <div className="k">Seasons completed</div>
          <div className="v">{awardRows.length}</div>
          <div className="d">{scope ? 'Champion' : 'Champions crowned'}</div>
        </div>
        <div className="stat">
          <div className="k">Title leaders</div>
          <div className="v">{data.titles[0]?.titles ?? 0}</div>
          <div className="d">{data.titles[0]?.name || 'No champion yet'}</div>
        </div>
      </div>

      <div className="grid side">
        <div className="panel">
          <div className="panel-head">
            <h3>Most times champion</h3>
            <span className="right tiny muted">{scope || 'All seasons'}</span>
          </div>
          <div className="panel-body flush">
            {data.titles.length ? (
              <table className="sheet">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th className="right">Titles</th>
                  </tr>
                </thead>
                <tbody>
                  {data.titles.map((t, i) => (
                    <tr key={t.id}>
                      <td className="pos">{i + 1}</td>
                      <td>
                        <div className="team-cell">
                          <Crest team={{ short_name: t.short_name, name: t.name, color: t.color }} size={26} />
                          <div>
                            <div className="strong">{t.name}</div>
                            <span className="sub">{t.short_name}</span>
                          </div>
                        </div>
                      </td>
                      <td className="right">
                        <span className="display" style={{ fontSize: 24, color: 'var(--amber-deep)' }}>
                          {t.titles}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="No champions yet">Complete a season with playoffs to crown one.</Empty>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Champions by season</h3>
          </div>
          <div className="panel-body flush">
            {awardRows.length ? (
              <table className="sheet compact">
                <tbody>
                  {awardRows.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link to={`/seasons/${s.id}`} className="strong">
                          {s.name}
                        </Link>
                        <span className="sub">{s.format?.toUpperCase()}</span>
                      </td>
                      <td className="right">
                        {s.winner_name ? (
                          <span className="row" style={{ justifyContent: 'flex-end', gap: 7 }}>
                            <Crest
                              team={{ short_name: s.winner_short, name: s.winner_name, color: '#2f6b3f' }}
                              size={20}
                            />
                            <span className="small">{s.winner_short}</span>
                          </span>
                        ) : (
                          <span className="small muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="The book is empty">Play a season to fill the first page.</Empty>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
