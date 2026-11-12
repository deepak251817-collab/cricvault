import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../App.jsx';
import { Crest, Empty, RoleBadge, Spinner } from '../ui.jsx';

function totalLine(bat, bowl) {
  return [
    bat.runs ? `${bat.runs} runs` : null,
    bowl.wickets ? `${bowl.wickets} wickets` : null,
    bat.innings ? `${bat.innings} innings` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function PlayerPage() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    api(`/players/${id}`)
      .then((d) => alive && setData(d))
      .catch((err) => toast(err.message, 'error'));
    return () => {
      alive = false;
    };
  }, [id, toast]);

  if (!data) return <Spinner label="Opening player file" />;

  const { player, careerBat, careerBowl, seasons, current, previous, titles } = data;

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <div className="eyebrow">
            <Link to="/players">Players</Link> / profile
          </div>
          <h1>{player.name}</h1>
          <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>
            <RoleBadge role={player.role} />
            {player.batting_style ? <span className="badge role">{player.batting_style}-hand bat</span> : null}
            {player.bowl_style ? <span className="badge role">{player.bowl_style} bowler</span> : null}
            {titles ? <span className="badge win">{titles} title{titles === 1 ? '' : 's'}</span> : null}
          </div>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 18 }}>
        <div className="panel">
          <div className="panel-head">
            <h3>Current team</h3>
          </div>
          <div className="panel-body">
            {current ? (
              <>
                <div className="team-cell">
                  <Crest team={{ short_name: current.team_short, name: current.team_name, color: current.team_color }} size={30} />
                  <div>
                    <div className="strong">{current.team_name}</div>
                    <span className="sub">{current.season_name}</span>
                  </div>
                </div>
                <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
                  {current.is_captain ? <span className="badge capt">Captain</span> : null}
                  {current.is_wicketkeeper ? <span className="badge wk">Wicketkeeper</span> : null}
                </div>
              </>
            ) : (
              <span className="muted small">Not assigned to a season squad yet.</span>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>Last season team</h3>
          </div>
          <div className="panel-body">
            {previous ? (
              <div className="team-cell">
                <Crest team={{ short_name: previous.team_short, name: previous.team_name, color: previous.team_color }} size={30} />
                <div>
                  <div className="strong">{previous.team_name}</div>
                  <span className="sub">{previous.season_name}</span>
                </div>
              </div>
            ) : (
              <span className="muted small">No earlier season on record.</span>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>Career</h3>
          </div>
          <div className="panel-body">
            <div className="display" style={{ fontSize: 26 }}>
              {totalLine(careerBat, careerBowl) || 'No matches yet'}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              {seasons.length} season{seasons.length === 1 ? '' : 's'} · {careerBat.highScore} highest score
            </div>
          </div>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="k">Runs</div>
          <div className="v">
            {careerBat.runs}
            <small>avg {careerBat.average}</small>
          </div>
          <div className="d">
            SR {careerBat.strikeRate} · {careerBat.fours}×4 · {careerBat.sixes}×6
          </div>
        </div>
        <div className="stat">
          <div className="k">Highest score</div>
          <div className="v">{careerBat.highScore}</div>
          <div className="d">
            {careerBat.fifties} fifties · {careerBat.hundreds} hundreds
          </div>
        </div>
        <div className="stat">
          <div className="k">Wickets</div>
          <div className="v">
            {careerBowl.wickets}
            <small>best {careerBowl.best}</small>
          </div>
          <div className="d">{careerBowl.economy != null ? `Econ ${careerBowl.economy}` : 'Has not bowled'}</div>
        </div>
        <div className="stat">
          <div className="k">Fielding</div>
          <div className="v">
            {careerBowl.catches}
            <small>{careerBowl.stumpings} st</small>
          </div>
          <div className="d">
            {careerBowl.stumpings} stumpings · {careerBowl.runOuts} run outs
          </div>
        </div>
        <div className="stat">
          <div className="k">Player of the match</div>
          <div className="v">{data.playerOfMatch ?? 0}</div>
          <div className="d">Awards across every match</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Season by season</h3>
          <span className="sub">Team history and output</span>
        </div>
        <div className="panel-body flush">
          {seasons.length ? (
            <div className="table-wrap">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th>Team</th>
                    <th className="right">Inns</th>
                    <th className="right">Runs</th>
                    <th className="right">HS</th>
                    <th className="right">SR</th>
                    <th className="right">Wkts</th>
                    <th className="right">Best</th>
                    <th className="right">Econ</th>
                  </tr>
                </thead>
                <tbody>
                  {seasons.map((s) => (
                    <tr key={s.seasonId}>
                      <td>
                        <Link to={`/seasons/${s.seasonId}`} className="strong">
                          {s.seasonName}
                        </Link>
                        <span className="sub">{s.format?.toUpperCase()}</span>
                      </td>
                      <td>
                        <div className="team-cell">
                          <Crest team={{ short_name: s.teamShort, name: s.teamName, color: s.teamColor }} size={20} />
                          <span className="small">{s.teamName}</span>
                        </div>
                        {s.isCaptain || s.isWicketkeeper ? (
                          <span className="sub">
                            {[s.isCaptain ? 'Captain' : null, s.isWicketkeeper ? 'Keeper' : null].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="num">{s.batting.innings}</td>
                      <td className="num strong">{s.batting.runs}</td>
                      <td className="num">{s.batting.highScore}</td>
                      <td className="num">{s.batting.strikeRate}</td>
                      <td className="num strong">{s.bowling.wickets}</td>
                      <td className="num">{s.bowling.best}</td>
                      <td className="num">{s.bowling.economy ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No season history">Add this player to a season squad to start their record.</Empty>
          )}
        </div>
      </div>
    </>
  );
}
