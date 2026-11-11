import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../App.jsx';
import { Crest, Empty, Spinner, ballClass, formatDate } from '../ui.jsx';

const overs = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

function WheelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      {[0, 45, 90, 135].map((deg) => (
        <line
          key={deg}
          x1="12"
          y1="3.4"
          x2="12"
          y2="20.6"
          transform={`rotate(${deg} 12 12)`}
          stroke="currentColor"
          strokeWidth="1.1"
        />
      ))}
    </svg>
  );
}

function Innings({ card, teams }) {
  const battingTeam = teams[card.battingTeamId];
  const notOut = card.batting.filter((b) => !b.out && !b.didNotBat).length;
  const [showWheel, setShowWheel] = useState(false);
  const partnerships = card.partnerships || [];
  const overGroups = card.overGroups || [];
  const peak = overGroups.reduce((max, over) => Math.max(max, over.runs), 1);
  return (
    <section className="innings-block" id={`innings-${card.inningsNo}`}>
      <div className="innings-title">
        <Crest team={battingTeam} size={26} />
        <h3>{battingTeam?.name || 'Team'}</h3>
        <span className="tiny muted">
          Innings {card.inningsNo}
          {card.declared ? ' · declared' : ''}
          {card.target
            ? card.closed
              ? ` · target ${card.target}`
              : ` · needs ${card.chase} to win${
                  card.ballsRemaining != null ? ` in ${card.ballsRemaining} balls` : ''
                }`
            : ''}
        </span>
        <div className="score">
          {card.runs}/{card.wickets}
          <span className="muted" style={{ fontSize: 14, marginLeft: 6 }}>
            ({card.overs} ov)
          </span>
        </div>
        {overGroups.length ? (
          <button
            type="button"
            className={`wheel-btn${showWheel ? ' on' : ''}`}
            onClick={() => setShowWheel((v) => !v)}
            aria-expanded={showWheel}
            aria-label="Show partnerships and runs per over"
            title="Partnerships and runs per over"
          >
            <WheelIcon />
          </button>
        ) : null}
      </div>

      {showWheel ? (
        <div className="wheel-panel">
          <div className="wheel-col">
            <h4>Partnerships</h4>
            {partnerships.length ? (
              <ul className="part-list">
                {partnerships.map((p, index) => (
                  <li key={index}>
                    <span className="part-no">{index + 1}</span>
                    <span className="part-names">
                      {p.aName} <em>and</em> {p.bName}
                      {p.contribs?.length ? (
                        <span className="part-contrib">
                          {p.contribs
                            .map((c) => `${c.name} ${c.runs} (${c.balls})`)
                            .join('  ·  ')}
                        </span>
                      ) : null}
                    </span>
                    <span className="part-runs">
                      <b>{p.runs}</b>
                      <span className="muted"> ({p.balls})</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No partnerships yet.</p>
            )}
          </div>
          <div className="wheel-col">
            <h4>Runs per over</h4>
            <div className="over-chart">
              {overGroups.map((over) => (
                <div
                  className="over-col"
                  key={over.overNo}
                  title={`Over ${over.overNo}: ${over.runs} runs, ${over.bowlerName}`}
                >
                  <span className="over-val">{over.runs}</span>
                  <div className="over-bar">
                    <i
                      className={over.runs >= 10 ? 'hot' : ''}
                      style={{ height: `${Math.max(6, Math.round((over.runs / peak) * 100))}%` }}
                    />
                  </div>
                  <span className="over-no">{over.overNo}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th style={{ width: '34%' }}>Batter</th>
              <th>Dismissal</th>
              <th className="right">R</th>
              <th className="right">B</th>
              <th className="right">4s</th>
              <th className="right">6s</th>
              <th className="right">SR</th>
            </tr>
          </thead>
          <tbody>
            {card.batting.map((b) => (
              <tr key={b.playerId}>
                <td>
                  <Link to={`/players/${b.playerId}`} className="strong">
                    {b.name}
                  </Link>
                  {notOut && !b.out && !b.didNotBat ? <span className="sub">not out</span> : null}
                </td>
                <td className="small muted">
                  {b.didNotBat ? 'did not bat' : b.out ? b.dismissalText : 'not out'}
                </td>
                <td className="num strong">{b.runs}</td>
                <td className="num">{b.balls}</td>
                <td className="num">{b.fours}</td>
                <td className="num">{b.sixes}</td>
                <td className="num">{b.didNotBat ? '—' : b.balls ? ((b.runs / b.balls) * 100).toFixed(1) : '—'}</td>
              </tr>
            ))}
            {!card.batting.length ? (
              <tr>
                <td colSpan={7} className="muted small">
                  No deliveries recorded.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                Extras {card.extrasTotal} (wd {card.extras.wides}, nb {card.extras.noballs}, b {card.extras.byes}, lb{' '}
                {card.extras.legByes})
              </td>
              <td colSpan={5} className="right">
                {card.runs}/{card.wickets} · {card.overs} overs
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {card.fallOfWickets.length ? (
        <div className="fow">
          <b>Fall of wickets:</b>{' '}
          {card.fallOfWickets.map((f) => `${f.wicket}-${f.runs} (${f.name}, ${overs(f.balls)} ov)`).join(', ')}
        </div>
      ) : null}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="sheet compact">
          <thead>
            <tr>
              <th>Bowler</th>
              <th className="right">O</th>
              <th className="right">M</th>
              <th className="right">R</th>
              <th className="right">W</th>
              <th className="right">Econ</th>
            </tr>
          </thead>
          <tbody>
            {card.bowling.map((b) => (
              <tr key={b.playerId}>
                <td>
                  <Link to={`/players/${b.playerId}`}>{b.name}</Link>
                </td>
                <td className="num">{overs(b.balls)}</td>
                <td className="num">{b.maidens}</td>
                <td className="num">{b.runs}</td>
                <td className="num strong">{b.wickets}</td>
                <td className="num">{b.economy}</td>
              </tr>
            ))}
            {!card.bowling.length ? (
              <tr>
                <td colSpan={6} className="muted small">
                  No bowling recorded.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {card.overGroups?.length ? (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="sheet compact">
            <thead>
              <tr>
                <th style={{ width: 96 }}>Over</th>
                <th>Ball by ball</th>
                <th className="right" style={{ width: 58 }}>
                  Runs
                </th>
              </tr>
            </thead>
            <tbody>
              {card.overGroups.map((over) => (
                <tr key={over.overNo}>
                  <td>
                    <b>{over.overNo}</b>
                    <span className="sub">{over.bowlerName}</span>
                  </td>
                  <td>
                    <span className="ball-row">
                      {over.tokens.map((token, index) => (
                        <span key={index} className={ballClass(token)}>
                          {token}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="num strong">{over.runs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default function Scorecard() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api(`/matches/${id}/scorecard`)
      .then((d) => alive && setData(d))
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
  }, [id, toast]);

  if (!data) return <Spinner label="Printing the scorecard" />;

  const match = data.match;
  const teams = {
    [data.teamA?.id]: data.teamA,
    [data.teamB?.id]: data.teamB,
  };

  return (
    <>
      <div className="page-head no-print">
        <div className="titles">
          <div className="eyebrow">
            <Link to="/matches">Matches</Link> / scorecard
          </div>
          <h1>Scorecard</h1>
          <div className="sub">
            {data.season?.name} · {match.stage === 'playoff' ? match.stage_name : `Match ${match.match_no || ''}`}
          </div>
        </div>
        <div className="page-actions">
          <Link className="btn" to={`/matches/${match.id}`}>
            Scoring console
          </Link>
          <button type="button" className="btn btn-dark" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      <div className="scorecard-head">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">
            {formatDate(match.scheduled_at)} {match.venue ? `· ${match.venue}` : ''}
          </div>
          <div className="row wrap" style={{ gap: 12, marginTop: 8 }}>
            <Crest team={data.teamA} size={34} />
            <h2 style={{ margin: 0 }}>{data.teamA?.name || 'TBD'}</h2>
            <span className="vs">V</span>
            <h2 style={{ margin: 0 }}>{data.teamB?.name || 'TBD'}</h2>
            <Crest team={data.teamB} size={34} />
          </div>
        </div>
        <div className="result">
          <b>{match.result_text || (match.status === 'live' ? 'Match in progress' : 'Awaiting result')}</b>
          <span className="tiny muted">
            {match.toss_winner_id
              ? `Toss: ${match.toss_winner_id === match.team_a_id ? data.teamA?.name : data.teamB?.name} chose to ${match.toss_decision}`
              : ''}
          </span>
        </div>
      </div>

      {data.cards.length > 1 ? (
        <div className="innings-jump no-print">
          {data.cards.map((card) => (
            <button
              key={card.inningsId}
              type="button"
              className={`innings-jump-btn${card.closed ? '' : ' live'}`}
              onClick={() =>
                document
                  .getElementById(`innings-${card.inningsNo}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              title={`Jump to innings ${card.inningsNo}`}
            >
              <span className="tag">I{card.inningsNo}</span>
              <span className="val">
                {card.runs}/{card.wickets}
              </span>
              <span className="ov">{card.overs} ov</span>
            </button>
          ))}
        </div>
      ) : null}

      {data.cards.length ? (
        data.cards.map((card) => <Innings key={card.inningsId} card={card} teams={teams} />)
      ) : (
        <div className="panel" style={{ marginTop: 18 }}>
          <Empty title="No innings yet">Start the match from the scoring console.</Empty>
        </div>
      )}
    </>
  );
}
