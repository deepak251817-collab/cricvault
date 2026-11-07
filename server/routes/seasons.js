import express from 'express';
import { db, now } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { pointsTable, seasonAwards, seedPlayoffs, playoffTemplate, leaderboards, formatLabel } from '../engine.js';

const router = express.Router();
router.use(requireAuth);

function seasonMatches(seasonId) {
  return db
    .prepare(
      `SELECT m.*, ta.name AS team_a_name, ta.short_name AS team_a_short, ta.color AS team_a_color,
              tb.name AS team_b_name, tb.short_name AS team_b_short, tb.color AS team_b_color
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       WHERE m.season_id = ?
       ORDER BY CASE m.stage WHEN 'league' THEN 0 ELSE 1 END, m.match_no, m.scheduled_at, m.id`
    )
    .all(seasonId);
}

function seasonSquads(seasonId) {
  const rows = db
    .prepare(
      `SELECT sp.*, p.name, p.role, p.bowl_style, p.batting_style, t.name AS team_name, t.short_name AS team_short
       FROM season_players sp
       JOIN players p ON p.id = sp.player_id
       JOIN teams t ON t.id = sp.team_id
       WHERE sp.season_id = ?
       ORDER BY t.name, p.name`
    )
    .all(seasonId);
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.team_id]) grouped[row.team_id] = [];
    grouped[row.team_id].push(row);
  }
  return grouped;
}

router.get('/seasons', (req, res) => {
  const seasons = db
    .prepare(
      `SELECT s.*, t.name AS winner_name, t.short_name AS winner_short, t.color AS winner_color,
              ru.name AS runner_up_name,
              (SELECT COUNT(*) FROM season_teams st WHERE st.season_id = s.id) AS team_count,
              (SELECT COUNT(*) FROM matches m WHERE m.season_id = s.id) AS match_count,
              (SELECT COUNT(*) FROM matches m WHERE m.season_id = s.id AND m.status = 'completed') AS completed_count
       FROM seasons s
       LEFT JOIN teams t ON t.id = s.winner_team_id
       LEFT JOIN teams ru ON ru.id = s.runner_up_team_id
       ORDER BY s.created_at DESC, s.id DESC`
    )
    .all();
  res.json(seasons.map((s) => ({ ...s, formatLabel: formatLabel(s) })));
});

router.post('/seasons', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Season name is required' });
  const format = ['t20', 'odi', 'test', 'custom'].includes(req.body?.format) ? req.body.format : 't20';
  let overs = null;
  if (format === 't20') overs = 20;
  else if (format === 'odi') overs = 50;
  else if (format === 'custom' && req.body?.oversPerInnings) {
    overs = Number(req.body.oversPerInnings);
    if (!Number.isFinite(overs) || overs < 1 || overs > 900) return res.status(400).json({ error: 'Overs must be between 1 and 900' });
  }
  let inningsLimit = 2;
  if (format === 'test') inningsLimit = 4;
  else if (format === 'custom' && Number(req.body?.inningsLimit) === 4) inningsLimit = 4;
  const playoffTeams = [2, 4, 5].includes(Number(req.body?.playoffTeams)) ? Number(req.body.playoffTeams) : 4;

  const info = db
    .prepare(
      `INSERT INTO seasons (name, format, overs_per_innings, innings_limit, status, playoff_teams, starts_on, notes, created_at)
       VALUES (?,?,?,?, 'draft', ?, ?, ?, ?)`
    )
    .run(
      name,
      format,
      overs,
      inningsLimit,
      playoffTeams,
      req.body?.startsOn || null,
      req.body?.notes || null,
      now()
    );
  const seasonId = info.lastInsertRowid;
  const teamIds = Array.isArray(req.body?.teamIds) ? req.body.teamIds.map(Number).filter(Boolean) : [];
  for (const teamId of teamIds) {
    if (db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) {
      db.prepare('INSERT OR IGNORE INTO season_teams (season_id, team_id, added_at) VALUES (?,?,?)').run(seasonId, teamId, now());
    }
  }
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  res.status(201).json({ ...season, formatLabel: formatLabel(season) });
});

router.get('/seasons/:id', (req, res) => {
  const seasonId = Number(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const teams = db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM season_players sp WHERE sp.season_id = ? AND sp.team_id = t.id) AS squad_count
       FROM season_teams st JOIN teams t ON t.id = st.team_id
       WHERE st.season_id = ? ORDER BY t.name`
    )
    .all(seasonId, seasonId);
  const matches = seasonMatches(seasonId);
  const points = pointsTable(seasonId);
  const awards = seasonAwards(seasonId);
  const squads = seasonSquads(seasonId);
  const stats = leaderboards({ seasonId, limit: 10 });
  const winner = season.winner_team_id ? db.prepare('SELECT * FROM teams WHERE id = ?').get(season.winner_team_id) : null;
  const runnerUp = season.runner_up_team_id
    ? db.prepare('SELECT * FROM teams WHERE id = ?').get(season.runner_up_team_id)
    : null;
  res.json({
    season: { ...season, formatLabel: formatLabel(season) },
    teams,
    matches,
    points,
    awards,
    squads,
    stats,
    winner,
    runnerUp,
    teamCount: teams.length,
    leagueMatches: matches.filter((m) => m.stage === 'league').length,
    playoffMatches: matches.filter((m) => m.stage === 'playoff').length,
  });
});

router.patch('/seasons/:id', requireAdmin, (req, res) => {
  const seasonId = Number(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const status = ['draft', 'fixtures', 'live', 'playoffs', 'completed'].includes(req.body?.status)
    ? req.body.status
    : season.status;
  const winnerTeamId =
    req.body?.winnerTeamId !== undefined ? (req.body.winnerTeamId ? Number(req.body.winnerTeamId) : null) : season.winner_team_id;
  const runnerUpId =
    req.body?.runnerUpTeamId !== undefined ? (req.body.runnerUpTeamId ? Number(req.body.runnerUpTeamId) : null) : season.runner_up_team_id;
  const playoffTeams = [2, 4, 5].includes(Number(req.body?.playoffTeams)) ? Number(req.body.playoffTeams) : season.playoff_teams;
  db.prepare(
    `UPDATE seasons SET name = ?, status = ?, playoff_teams = ?, starts_on = ?, notes = ?,
       winner_team_id = ?, runner_up_team_id = ? WHERE id = ?`
  ).run(
    req.body?.name != null ? String(req.body.name).trim() : season.name,
    status,
    playoffTeams,
    req.body?.startsOn ?? season.starts_on,
    req.body?.notes ?? season.notes,
    winnerTeamId,
    runnerUpId,
    seasonId
  );
  const updated = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  res.json({ ...updated, formatLabel: formatLabel(updated) });
});

router.delete('/seasons/:id', requireAdmin, (req, res) => {
  const seasonId = Number(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const matches = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE season_id = ?').get(seasonId).n;
  const deliveries = db
    .prepare('SELECT COUNT(*) AS n FROM deliveries WHERE match_id IN (SELECT id FROM matches WHERE season_id = ?)')
    .get(seasonId).n;
  // Season tables, squads, fixtures, innings and every ball go with it (ON DELETE CASCADE).
  db.prepare('DELETE FROM seasons WHERE id = ?').run(seasonId);
  res.json({ deleted: true, name: season.name, matches, deliveries });
});

router.post('/seasons/:id/teams', requireAdmin, (req, res) => {
  const seasonId = Number(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const ids = (Array.isArray(req.body?.teamIds) ? req.body.teamIds : [req.body?.teamId]).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one team' });
  const added = [];
  for (const teamId of ids) {
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!team) continue;
    const exists = db.prepare('SELECT 1 FROM season_teams WHERE season_id = ? AND team_id = ?').get(seasonId, teamId);
    if (exists) continue;
    db.prepare('INSERT INTO season_teams (season_id, team_id, added_at) VALUES (?,?,?)').run(seasonId, teamId, now());
    added.push(teamId);
  }
  res.json({ added });
});

router.delete('/seasons/:id/teams/:teamId', requireAdmin, (req, res) => {
  const seasonId = Number(req.params.id);
  const teamId = Number(req.params.teamId);
  const played = db
    .prepare('SELECT COUNT(*) AS n FROM matches WHERE season_id = ? AND (team_a_id = ? OR team_b_id = ?)')
    .get(seasonId, teamId, teamId).n;
  if (played > 0) return res.status(400).json({ error: 'This team has fixtures in this season. Remove those fixtures first.' });
  db.prepare('DELETE FROM season_players WHERE season_id = ? AND team_id = ?').run(seasonId, teamId);
  db.prepare('DELETE FROM season_teams WHERE season_id = ? AND team_id = ?').run(seasonId, teamId);
  res.json({ removed: true });
});

router.get('/seasons/:id/points', (req, res) => {
  res.json(pointsTable(Number(req.params.id)));
});

router.get('/seasons/:id/awards', (req, res) => {
  res.json(seasonAwards(Number(req.params.id)));
});

/* ----------------------------- fixtures ----------------------------- */

function roundRobin(teamIds) {
  const list = [...teamIds];
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

router.post('/seasons/:id/fixtures', requireAdmin, (req, res) => {
  const seasonId = Number(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const teams = db.prepare('SELECT team_id FROM season_teams WHERE season_id = ?').all(seasonId).map((r) => r.team_id);
  if (teams.length < 2) return res.status(400).json({ error: 'Add at least two teams to the season first' });

  const live = db
    .prepare("SELECT COUNT(*) AS n FROM matches WHERE season_id = ? AND status IN ('live','completed')")
    .get(seasonId).n;
  if (live > 0) return res.status(400).json({ error: 'Fixtures can only be regenerated before any match is played' });

  const legs = Math.min(4, Math.max(1, Number(req.body?.legs) || 1));

  db.prepare("DELETE FROM matches WHERE season_id = ? AND stage = 'league'").run(seasonId);

  const legsArr = Array.from({ length: legs }, (_, i) => i);
  const rounds = roundRobin(teams);
  const fixtureList = [];
  for (const leg of legsArr) {
    for (const round of rounds) {
      for (const [a, b] of round) {
        fixtureList.push(leg % 2 === 0 ? [a, b] : [b, a]);
      }
    }
  }

  const insert = db.prepare(
    `INSERT INTO matches (season_id, stage, match_no, team_a_id, team_b_id, venue, scheduled_at, status,
      format, overs, innings_limit, created_at)
     VALUES (?, 'league', ?, ?, ?, null, null, 'scheduled', ?, ?, ?, ?)`
  );
  fixtureList.forEach(([a, b], index) => {
    insert.run(seasonId, index + 1, a, b, season.format, season.overs_per_innings, season.innings_limit, now());
  });

  db.prepare("UPDATE seasons SET status = CASE WHEN status = 'draft' THEN 'fixtures' ELSE status END WHERE id = ?").run(seasonId);
  res.status(201).json({ created: fixtureList.length, matches: seasonMatches(seasonId) });
});

router.post('/seasons/:id/matches', requireAdmin, (req, res) => {
  const seasonId = Number(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const a = Number(req.body?.teamAId);
  const b = Number(req.body?.teamBId);
  if (!a || !b || a === b) return res.status(400).json({ error: 'Pick two different teams' });
  const next = db.prepare('SELECT COALESCE(MAX(match_no), 0) + 1 AS n FROM matches WHERE season_id = ?').get(seasonId).n;
  const info = db
    .prepare(
      `INSERT INTO matches (season_id, stage, match_no, team_a_id, team_b_id, venue, scheduled_at, status,
        format, overs, innings_limit, created_at)
       VALUES (?, 'league', ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`
    )
    .run(
      seasonId,
      next,
      a,
      b,
      req.body?.venue || null,
      req.body?.scheduledAt || null,
      season.format,
      season.overs_per_innings,
      season.innings_limit,
      now()
    );
  res.status(201).json(db.prepare('SELECT * FROM matches WHERE id = ?').get(info.lastInsertRowid));
});

/* ----------------------------- playoffs ----------------------------- */

router.post('/seasons/:id/playoffs', requireAdmin, (req, res) => {
  const seasonId = Number(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  let ordered = [];
  if (Array.isArray(req.body?.teamIds) && req.body.teamIds.length) {
    ordered = req.body.teamIds.map(Number).filter(Boolean);
  } else if (req.body?.size) {
    ordered = pointsTable(seasonId)
      .slice(0, Number(req.body.size))
      .map((r) => r.teamId);
  }
  if (![2, 4, 5].includes(ordered.length)) {
    return res.status(400).json({ error: 'Choose a 2, 4 or 5 team playoff format' });
  }
  if (new Set(ordered).size !== ordered.length) return res.status(400).json({ error: 'Each team can only appear once' });
  const valid = new Set(db.prepare('SELECT team_id FROM season_teams WHERE season_id = ?').all(seasonId).map((r) => r.team_id));
  if (ordered.some((id) => !valid.has(id))) return res.status(400).json({ error: 'All playoff teams must belong to this season' });

  try {
    const created = seedPlayoffs(seasonId, ordered);
    res.status(201).json({ created: created.length, matches: seasonMatches(seasonId), template: playoffTemplate(ordered.length) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/seasons/:id/playoffs', requireAdmin, (req, res) => {
  const seasonId = Number(req.params.id);
  const started = db
    .prepare("SELECT COUNT(*) AS n FROM matches WHERE season_id = ? AND stage = 'playoff' AND status IN ('live','completed')")
    .get(seasonId).n;
  if (started > 0) return res.status(400).json({ error: 'Playoff matches have already been played' });
  db.prepare("DELETE FROM matches WHERE season_id = ? AND stage = 'playoff'").run(seasonId);
  db.prepare("UPDATE seasons SET status = 'fixtures', winner_team_id = NULL, runner_up_team_id = NULL WHERE id = ?").run(seasonId);
  res.json({ removed: true });
});

export default router;
