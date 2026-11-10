import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../App.jsx';
import { Crest, Empty, Spinner } from '../ui.jsx';

/* Each leaderboard says which block of the payload it lives in, the number it
   ranks by, and the supporting columns worth showing beside it. */
const GROUPS = [
  {
    key: 'batting',
    label: 'Batting',
    source: 'battingBoards',
    note: 'Strike rate needs 30 balls faced · average needs 3 innings finished',
    cats: [
      {
        key: 'runs',
        label: 'Runs',
        value: (r) => r.runs,
        cols: [
          ['Inns', (r) => r.innings],
          ['HS', (r) => r.highScore],
          ['SR', (r) => r.strikeRate],
          ['100s', (r) => r.hundreds],
        ],
      },
      {
        key: 'highScore',
        label: 'Highest score',
        value: (r) => r.highScore,
        cols: [
          ['Runs', (r) => r.runs],
          ['Inns', (r) => r.innings],
          ['SR', (r) => r.strikeRate],
        ],
      },
      {
        key: 'hundreds',
        label: 'Hundreds',
        value: (r) => r.hundreds,
        cols: [
          ['Runs', (r) => r.runs],
          ['Inns', (r) => r.innings],
          ['50s', (r) => r.fifties],
        ],
      },
      {
        key: 'fifties',
        label: 'Fifties',
        value: (r) => r.fifties,
        cols: [
          ['Runs', (r) => r.runs],
          ['Inns', (r) => r.innings],
          ['100s', (r) => r.hundreds],
        ],
      },
      {
        key: 'sixes',
        label: 'Sixes',
        value: (r) => r.sixes,
        cols: [
          ['Runs', (r) => r.runs],
          ['Inns', (r) => r.innings],
          ['4s', (r) => r.fours],
        ],
      },
      {
        key: 'fours',
        label: 'Fours',
        value: (r) => r.fours,
        cols: [
          ['Runs', (r) => r.runs],
          ['Balls', (r) => r.balls],
          ['6s', (r) => r.sixes],
        ],
      },
      {
        key: 'strikeRate',
        label: 'Strike rate',
        value: (r) => r.strikeRate,
        cols: [
          ['Runs', (r) => r.runs],
          ['Balls', (r) => r.balls],
          ['Inns', (r) => r.innings],
        ],
      },
      {
        key: 'average',
        label: 'Average',
        value: (r) => r.average,
        cols: [
          ['Runs', (r) => r.runs],
          ['Outs', (r) => r.outs],
          ['Inns', (r) => r.innings],
        ],
      },
    ],
  },
  {
    key: 'bowling',
    label: 'Bowling',
    source: 'bowlingBoards',
    note: 'Economy needs 30 balls bowled · average needs 3 wickets',
    cats: [
      {
        key: 'wickets',
        label: 'Wickets',
        value: (r) => r.wickets,
        cols: [
          ['Inns', (r) => r.innings],
          ['Best', (r) => r.best],
          ['Econ', (r) => r.economy],
          ['5W', (r) => r.fiveWicketHauls],
        ],
      },
      {
        key: 'fiveWicketHauls',
        label: '5W hauls',
        value: (r) => r.fiveWicketHauls,
        cols: [
          ['Wkts', (r) => r.wickets],
          ['Best', (r) => r.best],
          ['Inns', (r) => r.innings],
        ],
      },
      {
        key: 'best',
        label: 'Best figures',
        value: (r) => r.best,
        weight: (r) => r.bestWickets,
        cols: [
          ['Wkts', (r) => r.wickets],
          ['Inns', (r) => r.innings],
          ['Econ', (r) => r.economy],
        ],
      },
      {
        key: 'economy',
        label: 'Economy',
        value: (r) => r.economy,
        invert: true,
        cols: [
          ['Balls', (r) => r.balls],
          ['Wkts', (r) => r.wickets],
          ['Runs', (r) => r.runs],
        ],
      },
      {
        key: 'average',
        label: 'Average',
        value: (r) => r.average,
        invert: true,
        cols: [
          ['Wkts', (r) => r.wickets],
          ['Runs', (r) => r.runs],
          ['Inns', (r) => r.innings],
        ],
      },
    ],
  },
  {
    key: 'fielding',
    label: 'Fielding',
    source: 'bowlingBoards',
    note: 'Catches include caught and bowled and stumpings credited to the keeper',
    cats: [
      {
        key: 'catches',
        label: 'Catches',
        value: (r) => r.catches,
        cols: [
          ['Run outs', (r) => r.runOuts],
          ['Inns', (r) => r.innings],
        ],
      },
    ],
  },
];

const LIMITS = [10, 25, 50, 100];
const MEDALS = ['var(--amber-deep)', 'var(--muted)', '#9a6b3f'];

export default function Records() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [seasonId, setSeasonId] = useState('');
  const [limit, setLimit] = useState(10);
  const [groupKey, setGroupKey] = useState('batting');
  const [catKey, setCatKey] = useState('runs');

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams();
    if (seasonId) query.set('seasonId', seasonId);
    query.set('limit', String(limit));
    api(`/stats/records?${query}`)
      .then((d) => alive && setData(d))
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
  }, [seasonId, limit, toast]);

  if (!data) return <Spinner label="Opening the record book" />;

  const scope = seasonId ? data.allSeasons.find((s) => String(s.id) === String(seasonId))?.name || 'Season' : null;
  const awardRows = seasonId ? data.seasonAwards.filter((s) => String(s.id) === String(seasonId)) : data.seasonAwards;
  const group = GROUPS.find((g) => g.key === groupKey) || GROUPS[0];
  const cat = group.cats.find((c) => c.key === catKey) || group.cats[0];
  const rows = data[group.source]?.[cat.key] || [];

  /* Bars are scaled to whichever number ranks this board, and inverted for the
     boards where a smaller number is the better one. */
  const weight = (row) => Number(cat.weight ? cat.weight(row) : cat.value(row)) || 0;
  const weights = rows.map(weight);
  const peak = Math.max(...weights, 0.0001);
  const floor = Math.min(...weights.filter((w) => w > 0), peak);
  const barWidth = (w) => {
    if (!w) return 0;
    const share = cat.invert ? (floor / w) * 100 : (w / peak) * 100;
    return Math.max(3, Math.min(100, Math.round(share)));
  };

  const pickGroup = (key) => {
    setGroupKey(key);
    setCatKey(GROUPS.find((g) => g.key === key)?.cats[0].key || 'runs');
  };

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

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <h3>{group.label} leaderboard</h3>
          <span className="right tiny muted">
            {scope || 'All seasons'} · Top {limit}
          </span>
        </div>
        <div className="panel-body">
          <div className="row" style={{ flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="seg">
              {GROUPS.map((g) => (
                <button key={g.key} type="button" className={g.key === groupKey ? 'on' : ''} onClick={() => pickGroup(g.key)}>
                  {g.label}
                </button>
              ))}
            </div>
            <div className="seg">
              {LIMITS.map((n) => (
                <button key={n} type="button" className={n === limit ? 'on' : ''} onClick={() => setLimit(n)}>
                  Top {n}
                </button>
              ))}
            </div>
          </div>

          <div className="tabs" style={{ margin: '0 0 12px' }}>
            {group.cats.map((c) => (
              <button key={c.key} type="button" className={`tab ${c.key === cat.key ? 'on' : ''}`} onClick={() => setCatKey(c.key)}>
                {c.label}
              </button>
            ))}
          </div>

          {rows.length ? (
            <div className="board">
              {rows.map((r, i) => (
                <Link
                  key={r.playerId}
                  to={`/players/${r.playerId}`}
                  className={`board-row${i === 0 ? ' lead' : ''}`}
                >
                  <span className="rank" style={i < 3 ? { color: MEDALS[i], fontWeight: 700 } : undefined}>
                    {i + 1}
                  </span>
                  <span className="who">
                    <span className="name">{r.name}</span>
                    <span className="meta">{cat.cols.map(([h, get]) => `${h} ${get(r)}`).join(' · ')}</span>
                  </span>
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${barWidth(weight(r))}%` }} />
                  </span>
                  <span className="val">{cat.value(r)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title={`No ${cat.label.toLowerCase()} yet`}>
              {scope ? `Nothing recorded in ${scope} for this list.` : 'Complete a match to start this list.'}
            </Empty>
          )}
          <div className="board-foot">
            <span>{group.note}</span>
            <span>{rows.length ? `${rows.length} of the top ${limit} shown` : 'Waiting for the first entry'}</span>
          </div>
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
