import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../App.jsx';
import { Crest, Empty, Spinner, ballClass, formatDate } from '../ui.jsx';

const overs = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

function Innings({ card, teams }) {
  const battingTeam = teams[card.battingTeamId];
  const notOut = card.batting.filter((b) => !b.out && !b.didNotBat).length;
  return (
    <section className="innings-block">
      <div className="innings-title">
        <Crest team={battingTeam} size={26} />
        <h3>{battingTeam?.name || 'Team'}</h3>
        <span className="tiny muted">
          Innings {card.inningsNo}
          {card.declared ? ' · declared' : ''}
          {card.target ? ` · target ${card.target}` : ''}
        </span>
        <div className="score">
          {card.runs}/{card.wickets}
          <span className="muted" style={{ fontSize: 14, marginLeft: 6 }}>
            ({card.overs} ov)
          </span>
        </div>
      </div>

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
