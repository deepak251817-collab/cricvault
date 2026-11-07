/**
 * Seed a demo league: teams, players, two seasons, simulated results,
 * one completed playoff final and one live match in progress.
 *
 *   node scripts/seed-demo.js          # only runs on an empty league
 *   node scripts/seed-demo.js --reset  # wipes cricket data first
 */
import { db, now } from '../server/db.js';
import { finalizeMatch, recomputeInningsState, seedPlayoffs, pointsTable } from '../server/engine.js';

if (process.argv.includes('--reset')) {
  db.exec(`
    DELETE FROM deliveries;
    DELETE FROM innings;
    DELETE FROM match_xi;
    DELETE FROM matches;
    DELETE FROM season_players;
    DELETE FROM season_teams;
    DELETE FROM seasons;
    DELETE FROM players;
    DELETE FROM teams;
    DELETE FROM sqlite_sequence WHERE name IN
      ('deliveries','innings','matches','season_players','season_teams','seasons','players','teams');
  `);
  console.log('Cleared previous cricket data.');
}

if (db.prepare('SELECT COUNT(*) AS n FROM seasons').get().n > 0) {
  console.log('Seasons already exist — nothing seeded. Re-run with --reset to rebuild the demo.');
  process.exit(0);
}

const TEAMS = [
  { name: 'Mumbai Mariners', short: 'MUM', color: '#1f4e79', ground: 'Harbour Oval' },
  { name: 'Chennai Chargers', short: 'CHE', color: '#c49a1a', ground: 'Marina Ground' },
  { name: 'Bengaluru Blaze', short: 'BLR', color: '#b03a2e', ground: 'Garden City Park' },
  { name: 'Kolkata Cobras', short: 'KOL', color: '#5b3a8e', ground: 'Hooghly Stadium' },
  { name: 'Delhi Dynamos', short: 'DEL', color: '#2f6b3f', ground: 'Yamuna Sports Ground' },
  { name: 'Jaipur Jaguars', short: 'JAI', color: '#c2185b', ground: 'Pink City Oval' },
];

const FIRST = [
  'Aarav', 'Vihaan', 'Rohan', 'Kabir', 'Arjun', 'Ishaan', 'Aditya', 'Karan', 'Nikhil', 'Rahul',
  'Siddharth', 'Varun', 'Dev', 'Manav', 'Yash', 'Pranav', 'Sameer', 'Harsh', 'Ankit', 'Kunal',
  'Ravi', 'Tarun', 'Mohit', 'Abhay', 'Krish', 'Neel', 'Omkar', 'Parth', 'Rudra', 'Shaan',
];
const LAST = [
  'Sharma', 'Iyer', 'Patel', 'Nair', 'Rao', 'Khan', 'Mehta', 'Verma', 'Kulkarni', 'Reddy',
  'Bose', 'Joshi', 'Menon', 'Gupta', 'Singh', 'Chawla', 'Desai', 'Pillai', 'Malhotra', 'Bhatt',
  'Sethi', 'Varma', 'Anand', 'Chauhan',
];
const ROLES = [
  'batter', 'batter', 'batter', 'batter', 'allrounder', 'allrounder',
  'allrounder', 'wicketkeeper', 'bowler', 'bowler', 'bowler', 'allrounder',
];

const insertTeam = db.prepare(
  'INSERT INTO teams (name, short_name, color, home_ground, is_active, created_at) VALUES (?,?,?,?,1,?)'
);
const insertPlayer = db.prepare(
  'INSERT INTO players (name, role, bowl_style, batting_style, is_active, created_at) VALUES (?,?,?,?,1,?)'
);
const insertSeason = db.prepare(
  `INSERT INTO seasons (name, format, overs_per_innings, innings_limit, status, playoff_teams, starts_on, notes, created_at)
   VALUES (?,?,?,?,?,?,?,?,?)`
);

const usedNames = new Set();
function makeName(teamIndex, playerIndex) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const first = FIRST[(teamIndex * 5 + playerIndex * 3 + attempt) % FIRST.length];
    const last = LAST[(teamIndex * 7 + playerIndex * 5 + attempt * 2) % LAST.length];
    const name = `${first} ${last}`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  const fallback = `Player ${teamIndex}-${playerIndex}`;
  usedNames.add(fallback);
  return fallback;
}

const teamIds = [];
const squads = {}; // teamId -> [{id, isWicketkeeper, isCaptain}]
for (const [ti, team] of TEAMS.entries()) {
  const teamId = Number(insertTeam.run(team.name, team.short, team.color, team.ground, now()).lastInsertRowid);
  teamIds.push(teamId);
  squads[teamId] = [];
  for (let pi = 0; pi < 12; pi += 1) {
    const role = ROLES[pi];
    const bowl = role === 'bowler' || role === 'allrounder' ? ['fast', 'spin', 'medium'][pi % 3] : null;
    const bat = pi % 3 === 0 ? 'left' : 'right';
    const playerId = Number(insertPlayer.run(makeName(ti, pi), role, bowl, bat, now()).lastInsertRowid);
    squads[teamId].push({ id: playerId, role, isWicketkeeper: role === 'wicketkeeper', isCaptain: pi === 0 });
  }
}

function enroll(seasonId, ids) {
  const stmt = db.prepare('INSERT INTO season_teams (season_id, team_id, added_at) VALUES (?,?,?)');
  const squadStmt = db.prepare(
    'INSERT INTO season_players (season_id, team_id, player_id, is_captain, is_wicketkeeper, added_at) VALUES (?,?,?,?,?,?)'
  );
  for (const teamId of ids) {
    stmt.run(seasonId, teamId, now());
    for (const p of squads[teamId]) {
      squadStmt.run(seasonId, teamId, p.id, p.isCaptain ? 1 : 0, p.isWicketkeeper ? 1 : 0, now());
    }
  }
}

function roundRobin(ids) {
  const list = [...ids];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds = [];
  let rotating = list.slice(1);
  for (let round = 0; round < n - 1; round += 1) {
    const lineup = [list[0], ...rotating];
    const pairs = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = lineup[i];
      const b = lineup[n - 1 - i];
      if (a && b) pairs.push(round % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

const insertMatch = db.prepare(
  `INSERT INTO matches (season_id, stage, match_no, stage_name, team_a_id, team_b_id, venue, scheduled_at,
      status, format, overs, innings_limit, created_at)
   VALUES (?,?,?,?,?,?,?,?, 'scheduled', ?,?,?, ?)`
);

function createFixtures(seasonId, ids, overs, startDate) {
  const fixtures = roundRobin(ids).flat();
  const ids2 = [];
  fixtures.forEach(([a, b], index) => {
    const when = new Date(new Date(`${startDate}T18:00:00`).getTime() + index * 2 * 86400000).toISOString();
    const id = Number(
      insertMatch.run(seasonId, 'league', index + 1, null, a, b, 'League Ground', when, 't20', overs, 2, now()).lastInsertRowid
    );
    ids2.push(id);
  });
  return ids2;
}

const WICKET_KINDS = ['bowled', 'caught', 'lbw', 'stumped', 'run out', 'caught and bowled'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function createInnings(matchId, no, battingTeamId, bowlingTeamId, target) {
  return Number(
    db
      .prepare(
        `INSERT INTO innings (match_id, innings_no, batting_team_id, bowling_team_id, target, closed, created_at)
         VALUES (?,?,?,?,?,0,?)`
      )
      .run(matchId, no, battingTeamId, bowlingTeamId, target, now()).lastInsertRowid
  );
}

function simulateInnings({ matchId, inningsId, battingXi, bowlingXi, maxBalls, target = null, close = true }) {
  let strikerIdx = 0;
  let nonStrikerIdx = 1;
  let nextIdx = 2;
  let runs = 0;
  let wickets = 0;
  let balls = 0;
  let legalInOver = 0;
  let lastBowler = null;

  const insert = db.prepare(
    `INSERT INTO deliveries (match_id, innings_id, over_no, ball_no, batter_id, non_striker_id, bowler_id,
       runs, extra_type, extra_runs, is_wicket, wicket_type, dismissed_id, fielder_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  while (balls < maxBalls && wickets < 10 && (target == null || runs < target)) {
    if (battingXi[strikerIdx] == null || battingXi[nonStrikerIdx] == null) break;
    const overNo = Math.floor(balls / 6) + 1;
    const ballNo = (balls % 6) + 1;
    let bowlerId = bowlingXi[Math.floor(balls / 6) % bowlingXi.length];
    if (bowlerId === lastBowler && bowlingXi.length > 1) {
      bowlerId = bowlingXi[(Math.floor(balls / 6) + 1) % bowlingXi.length];
    }

    let batRuns = 0;
    let extraType = null;
    let extraRuns = 0;
    let isWicket = false;
    let wicketType = null;
    let dismissedId = null;
    let fielderId = null;

    const roll = Math.random();
    if (roll < 0.045) {
      isWicket = true;
      wicketType = pick(WICKET_KINDS);
      dismissedId = battingXi[strikerIdx];
      if (['caught', 'run out', 'stumped'].includes(wicketType)) fielderId = pick(bowlingXi);
    } else if (roll < 0.07) {
      extraType = 'wd';
      extraRuns = 1;
    } else if (roll < 0.085) {
      extraType = 'nb';
      extraRuns = 1;
    } else {
      const p = Math.random();
      batRuns = p < 0.36 ? 0 : p < 0.64 ? 1 : p < 0.73 ? 2 : p < 0.74 ? 3 : p < 0.87 ? 4 : p < 0.92 ? 6 : 0;
    }

    insert.run(
      matchId,
      inningsId,
      overNo,
      ballNo,
      battingXi[strikerIdx],
      battingXi[nonStrikerIdx],
      bowlerId,
      batRuns,
      extraType,
      extraRuns,
      isWicket ? 1 : 0,
      wicketType,
      dismissedId,
      fielderId,
      now()
    );

    runs += batRuns + extraRuns;
    const legal = extraType == null;
    if (legal) {
      balls += 1;
      legalInOver += 1;
    }
    lastBowler = bowlerId;

    if (isWicket) {
      wickets += 1;
      if (nextIdx < battingXi.length) {
        strikerIdx = nextIdx;
        nextIdx += 1;
      } else {
        break;
      }
    } else if ((batRuns + (extraType === 'wd' ? Math.max(0, extraRuns - 1) : 0)) % 2 === 1) {
      [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
    }

    if (legal && legalInOver === 6) {
      [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
      legalInOver = 0;
    }
  }

  if (close) db.prepare('UPDATE innings SET closed = 1 WHERE id = ?').run(inningsId);
  return { runs, wickets, balls };
}

const insertXi = db.prepare(
  'INSERT INTO match_xi (match_id, team_id, player_id, is_captain, is_wk) VALUES (?,?,?,?,?)'
);

function lineup(teamId) {
  const squad = squads[teamId];
  const xi = squad.slice(0, 11).map((p) => p.id);
  const wk = squad.find((p) => p.isWicketkeeper)?.id || xi[0];
  const cap = squad.find((p) => p.isCaptain)?.id || xi[0];
  return { xi, wk, cap };
}

function setXi(matchId, teamId) {
  const { xi, wk, cap } = lineup(teamId);
  for (const playerId of xi) insertXi.run(matchId, teamId, playerId, playerId === cap ? 1 : 0, playerId === wk ? 1 : 0);
  return lineup(teamId);
}

function simulateMatch(matchId, teamAId, teamBId, overs, battingFirstId) {
  const first = setXi(matchId, teamAId);
  const second = setXi(matchId, teamBId);
  db.prepare("UPDATE matches SET status = 'live', toss_winner_id = ?, toss_decision = 'bat' WHERE id = ?").run(
    battingFirstId,
    matchId
  );
  const battingFirst = battingFirstId === teamAId ? first : second;
  const bowlingFirst = battingFirstId === teamAId ? second : first;
  const otherId = battingFirstId === teamAId ? teamBId : teamAId;

  const inn1 = createInnings(matchId, 1, battingFirstId, otherId, null);
  const t1 = simulateInnings({
    matchId,
    inningsId: inn1,
    battingXi: battingFirst.xi,
    bowlingXi: bowlingFirst.xi,
    maxBalls: overs * 6,
  });
  const target = t1.runs + 1;
  const inn2 = createInnings(matchId, 2, otherId, battingFirstId, target);
  simulateInnings({
    matchId,
    inningsId: inn2,
    battingXi: bowlingFirst.xi,
    bowlingXi: battingFirst.xi,
    maxBalls: overs * 6,
    target,
  });
  finalizeMatch(matchId);
}

/* ------------------------------ 2025 season ------------------------------ */

const season2025 = Number(
  insertSeason.run(
    '2025 Founders Cup',
    't20',
    20,
    2,
    'live',
    2,
    '2025-06-01',
    'The league’s first season, decided by a straight final.',
    now()
  ).lastInsertRowid
);
const teams2025 = teamIds.slice(0, 4);
enroll(season2025, teams2025);
const fixtures2025 = createFixtures(season2025, teams2025, 20, '2025-06-03');
for (const [index, matchId] of fixtures2025.entries()) {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  simulateMatch(matchId, match.team_a_id, match.team_b_id, 20, index % 2 === 0 ? match.team_a_id : match.team_b_id);
}

const table2025 = pointsTable(season2025);
const topTwo = table2025.slice(0, 2).map((r) => r.teamId);
const playoffMatches = seedPlayoffs(season2025, topTwo);
const finalMatch = playoffMatches[0];
simulateMatch(finalMatch.id, finalMatch.team_a_id, finalMatch.team_b_id, 20, finalMatch.team_a_id);
db.prepare("UPDATE seasons SET status = 'completed' WHERE id = ?").run(season2025);

/* ------------------------------ 2026 season ------------------------------ */

const season2026 = Number(
  insertSeason.run(
    '2026 Premier Season',
    't20',
    20,
    2,
    'live',
    5,
    '2026-09-12',
    'Six teams, double round robin and a top-five playoff bracket.',
    now()
  ).lastInsertRowid
);
enroll(season2026, teamIds);
const fixtures2026 = createFixtures(season2026, teamIds, 20, '2026-09-14');

const finished = fixtures2026.slice(0, 9);
for (const [index, matchId] of finished.entries()) {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  simulateMatch(matchId, match.team_a_id, match.team_b_id, 20, index % 2 === 0 ? match.team_a_id : match.team_b_id);
}

// One match in progress: 9.4 overs bowled, so the console opens mid-innings.
const liveMatchId = fixtures2026[9];
const liveMatch = db.prepare('SELECT * FROM matches WHERE id = ?').get(liveMatchId);
const liveFirstTeam = liveMatch.team_a_id;
const liveFirst = setXi(liveMatchId, liveMatch.team_a_id);
const liveSecond = setXi(liveMatchId, liveMatch.team_b_id);
db.prepare("UPDATE matches SET status = 'live', toss_winner_id = ?, toss_decision = 'bat' WHERE id = ?").run(
  liveFirstTeam,
  liveMatchId
);
const liveInnings = createInnings(liveMatchId, 1, liveFirstTeam, liveMatch.team_b_id, null);
simulateInnings({
  matchId: liveMatchId,
  inningsId: liveInnings,
  battingXi: liveFirst.xi,
  bowlingXi: liveSecond.xi,
  maxBalls: 58,
  close: false,
});
recomputeInningsState(liveInnings);

const summary = {
  teams: db.prepare('SELECT COUNT(*) AS n FROM teams').get().n,
  players: db.prepare('SELECT COUNT(*) AS n FROM players').get().n,
  matchesPlayed: db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status = 'completed'").get().n,
  liveMatches: db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status = 'live'").get().n,
  champion: db
    .prepare('SELECT t.name FROM seasons s JOIN teams t ON t.id = s.winner_team_id WHERE s.id = ?')
    .get(season2025)?.name,
};

console.log('');
console.log('CricVault demo seeded');
console.log('---------------------');
console.log(`Teams        ${summary.teams}`);
console.log(`Players      ${summary.players}`);
console.log(`Matches      ${summary.matchesPlayed} completed · ${summary.liveMatches} live`);
console.log(`2025 champion ${summary.champion || '—'}`);
console.log('2026         season in progress, 5 fixtures still to play');
console.log('');
console.log('Sign in with admin / admin123');
