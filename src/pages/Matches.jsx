import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useToast } from '../App.jsx';
import { Crest, Empty, Spinner, StatusBadge, formatDateTime } from '../ui.jsx';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'completed', label: 'Results' },
];

export default function Matches() {
  const { seasons, user } = useApp();
  const toast = useToast();
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ? String(seasons[0].id) : 'all');
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    const params = [];
    if (seasonId !== 'all') params.push(`seasonId=${seasonId}`);
    if (status !== 'all') params.push(`status=${status}`);
    api(`/matches${params.length ? `?${params.join('&')}` : ''}`)
      .then((data) => alive && setRows(data))
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
  }, [seasonId, status, toast]);

  const grouped = useMemo(() => {
    if (!rows) return [];
    const map = new Map();
    for (const m of rows) {
      const key = m.season_id;
      if (!map.has(key)) map.set(key, { name: m.season_name, matches: [] });
      map.get(key).matches.push(m);
    }
    return [...map.values()];
  }, [rows]);

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">Fixture list</div>
          <h1>Matches</h1>
          <div className="sub">
            League fixtures and playoff games. Live matches appear first; open one to score it ball by ball.
          </div>
        </div>
        <div className="page-actions">
          <select className="select" style={{ width: 220 }} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            <option value="all">All seasons</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="seg">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={status === f.key ? 'on' : ''} onClick={() => setStatus(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!rows ? (
        <Spinner label="Loading fixtures" />
      ) : !rows.length ? (
        <div className="panel">
          <Empty title="No matches here">
            {user.role === 'admin'
              ? 'Open a season and generate fixtures, or add a one-off match from the season page.'
              : 'Fixtures will appear once the administrator publishes them.'}
          </Empty>
        </div>
      ) : (
        grouped.map((group) => (
          <div className="panel" key={group.name} style={{ marginBottom: 18 }}>
            <div className="panel-head">
              <h3>{group.name}</h3>
              <span className="sub">{group.matches.length} matches</span>
            </div>
            <div className="panel-body flush">
              <div className="table-wrap">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th style={{ width: 54 }}>No</th>
                      <th>Fixture</th>
                      <th>Venue</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th className="right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.matches.map((m) => (
                      <tr key={m.id}>
                        <td className="num muted">{m.stage === 'playoff' ? 'P' : m.match_no || '—'}</td>
                        <td>
                          <div className="row" style={{ gap: 8 }}>
                            <Crest
                              team={{ short_name: m.team_a_short, name: m.team_a_name, color: m.team_a_color }}
                              size={22}
                            />
                            <Link to={`/matches/${m.id}`} className="strong">
                              {m.team_a_short || 'TBD'} <span className="muted" style={{ fontWeight: 400 }}>v</span>{' '}
                              {m.team_b_short || 'TBD'}
                            </Link>
                            {m.stage === 'playoff' ? <span className="badge playoffs">{m.stage_name}</span> : null}
                          </div>
                          <span className="sub">{m.result_text || `${m.team_a_name || 'TBD'} vs ${m.team_b_name || 'TBD'}`}</span>
                        </td>
                        <td className="small muted">{m.venue || '—'}</td>
                        <td className="small muted">{formatDateTime(m.scheduled_at)}</td>
                        <td>
                          {m.status === 'completed' ? (
                            <span className="badge win">Result</span>
                          ) : (
                            <StatusBadge status={m.status} />
                          )}
                        </td>
                        <td className="right">
                          {m.status === 'completed' || m.status === 'abandoned' ? (
                            <Link className="btn btn-sm" to={`/matches/${m.id}/scorecard`}>
                              Scorecard
                            </Link>
                          ) : (
                            <Link className="btn btn-sm btn-primary" to={`/matches/${m.id}`}>
                              {m.status === 'live' ? 'Score' : user.role === 'admin' ? 'Set up' : 'View'}
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}
