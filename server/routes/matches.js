import express from 'express';
import { db, now } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { getMatchState, getScorecard, addDelivery, closeInnings, recomputeInningsState, inningsTotals } from '../engine.js';

const router = express.Router();
router.use(requireAuth);

function matchWithNames(matchId) {
  return db
    .prepare(
      `SELECT m.*, ta.name AS team_a_name, ta.short_name AS team_a_short, ta.color AS team_a_color,
              tb.name AS team_b_name, tb.short_name AS team_b_short, tb.color AS team_b_color,
              s.name AS season_name, s.format AS season_format
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       LEFT JOIN seasons s ON s.id = m.season_id
       WHERE m.id = ?`
    )
    .get(matchId);
}

function inningsFor(matchId, inningsId) {
  return db.prepare('SELECT * FROM innings WHERE id = ? AND match_id = ?').get(Number(inningsId), matchId);
}

function xiRows(matchId) {
  return db
    .prepare(
      `SELECT xi.*, p.name, p.role FROM match_xi xi JOIN players p ON p.id = xi.player_id
       WHERE xi.match_id = ?`
    )
    .all(matchId);
}

router.get('/matches', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.seasonId) {
    where.push('m.season_id = ?');
    params.push(Number(req.query.seasonId));
  }
  if (req.query.teamId) {
    where.push('(m.team_a_id = ? OR m.team_b_id = ?)');
    params.push(Number(req.query.teamId), Number(req.query.teamId));
  }
  if (req.query.status) {
    where.push('m.status = ?');
    params.push(String(req.query.status));
  }
  if (req.query.stage) {
    where.push('m.stage = ?');
    params.push(String(req.query.stage));
  }
  const limit = Math.min(200, Number(req.query.limit) || 200);
  const rows = db
    .prepare(
      `SELECT m.*, ta.name AS team_a_name, ta.short_name AS team_a_short, ta.color AS team_a_color,
              tb.name AS team_b_name, tb.short_name AS team_b_short, tb.color AS team_b_color,
              s.name AS season_name
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       LEFT JOIN seasons s ON s.id = m.season_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY CASE m.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
                m.scheduled_at IS NULL, m.scheduled_at, m.id
       LIMIT ${limit}`
    )
    .all(...params);
  res.json(rows);
});

router.get('/matches/:id', (req, res) => {
  const matchId = Number(req.params.id);
  const state = getMatchState(matchId);
  if (!state) return res.status(404).json({ error: 'Match not found' });
  const squad = (teamId) =>
    db
      .prepare(
        `SELECT sp.player_id AS id, sp.is_captain, sp.is_wicketkeeper, p.name, p.role, p.bowl_style, p.batting_style
         FROM season_players sp JOIN players p ON p.id = sp.player_id
         WHERE sp.season_id = ? AND sp.team_id = ? ORDER BY p.name`
      )
      .all(state.match.season_id, teamId);
  res.json({
    ...state,
    squads: {
      [state.match.team_a_id]: squad(state.match.team_a_id),
      [state.match.team_b_id]: squad(state.match.team_b_id),
    },
    allPlayers: db
      .prepare(
        `SELECT sp.player_id AS id, sp.team_id, p.name, p.role FROM season_players sp JOIN players p ON p.id = sp.player_id
         WHERE sp.season_id = ?`
      )
      .all(state.match.season_id),
  });
});

router.get('/matches/:id/scorecard', (req, res) => {
  const card = getScorecard(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'Match not found' });
  res.json(card);
});

router.post('/matches/:id/start', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status !== 'scheduled') return res.status(400).json({ error: 'Match has already started' });
  if (!match.team_a_id || !match.team_b_id) return res.status(400).json({ error: 'Both teams must be set' });

  const tossWinnerId = Number(req.body?.tossWinnerId);
  const tossDecision = req.body?.tossDecision === 'bowl' ? 'bowl' : 'bat';
  if (![match.team_a_id, match.team_b_id].includes(tossWinnerId)) {
    return res.status(400).json({ error: 'Toss winner must be one of the two teams' });
  }

  const xiA = Array.isArray(req.body?.xiA) ? req.body.xiA.map(Number) : [];
  const xiB = Array.isArray(req.body?.xiB) ? req.body.xiB.map(Number) : [];
  const squadCaptain = (teamId) =>
    db
      .prepare('SELECT player_id FROM season_players WHERE season_id = ? AND team_id = ? AND is_captain = 1')
      .get(match.season_id, teamId)?.player_id || null;
  // Fall back to the captain named in the squad, so an XI always has one.
  const captainA = req.body?.captainA ? Number(req.body.captainA) : squadCaptain(match.team_a_id);
  const captainB = req.body?.captainB ? Number(req.body.captainB) : squadCaptain(match.team_b_id);
  const validate = (teamId, ids, label, captainId) => {
    const squad = db
      .prepare('SELECT player_id, is_wicketkeeper FROM season_players WHERE season_id = ? AND team_id = ?')
      .all(match.season_id, teamId);
    if (squad.length < 11) return `${label} needs at least 11 players in the season squad`;
    const squadIds = new Set(squad.map((s) => s.player_id));
    if (ids.length !== 11) return `${label} must name exactly 11 players`;
    if (new Set(ids).size !== 11) return `${label} has duplicate players`;
    if (ids.some((id) => !squadIds.has(id))) return `${label} has a player outside the season squad`;
    if (!captainId) return `${label} must name a captain in the playing XI`;
    if (!ids.includes(captainId)) return `${label}'s captain must be in the playing XI`;
    return null;
  };
  const errA = validate(match.team_a_id, xiA, 'Team A', captainA);
  if (errA) return res.status(400).json({ error: errA });
  const errB = validate(match.team_b_id, xiB, 'Team B', captainB);
  if (errB) return res.status(400).json({ error: errB });

  const wkA = Number(req.body?.wkA);
  const wkB = Number(req.body?.wkB);
  const flagFor = (teamId, playerId) =>
    db.prepare('SELECT is_wicketkeeper FROM season_players WHERE season_id = ? AND team_id = ? AND player_id = ?').get(
      match.season_id,
      teamId,
      playerId
    );
  if (!flagFor(match.team_a_id, wkA)?.is_wicketkeeper) {
    return res.status(400).json({ error: 'Pick a wicketkeeper for Team A who is flagged as a keeper in the squad' });
  }
  if (!flagFor(match.team_b_id, wkB)?.is_wicketkeeper) {
    return res.status(400).json({ error: 'Pick a wicketkeeper for Team B who is flagged as a keeper in the squad' });
  }
  if (!xiA.includes(wkA) || !xiB.includes(wkB)) {
    return res.status(400).json({ error: 'The wicketkeeper must be in the playing XI' });
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM match_xi WHERE match_id = ?').run(matchId);
    const insertXi = db.prepare(
      'INSERT INTO match_xi (match_id, team_id, player_id, is_captain, is_wk) VALUES (?,?,?,?,?)'
    );
    for (const id of xiA) insertXi.run(matchId, match.team_a_id, id, captainA === id ? 1 : 0, wkA === id ? 1 : 0);
    for (const id of xiB) insertXi.run(matchId, match.team_b_id, id, captainB === id ? 1 : 0, wkB === id ? 1 : 0);

    const battingFirst = tossDecision === 'bat' ? tossWinnerId : tossWinnerId === match.team_a_id ? match.team_b_id : match.team_a_id;
    const bowlingFirst = battingFirst === match.team_a_id ? match.team_b_id : match.team_a_id;
    db.prepare(
      "UPDATE matches SET status = 'live', toss_winner_id = ?, toss_decision = ?, winner_team_id = NULL, result_text = NULL, result_type = NULL WHERE id = ?"
    ).run(tossWinnerId, tossDecision, matchId);
    db.prepare('DELETE FROM innings WHERE match_id = ?').run(matchId);
    const info = db
      .prepare(
        `INSERT INTO innings (match_id, innings_no, batting_team_id, bowling_team_id, target, closed, created_at)
         VALUES (?, 1, ?, ?, NULL, 0, ?)`
      )
      .run(matchId, battingFirst, bowlingFirst, now());
    db.prepare("UPDATE seasons SET status = 'live' WHERE id = ? AND status IN ('draft','fixtures')").run(match.season_id);
    return info.lastInsertRowid;
  });
  const inningsId = tx();
  res.json({ ...getMatchState(matchId), inningsId });
});

router.post('/matches/:id/openers', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const innings = inningsFor(matchId, req.body?.inningsId);
  if (!innings) return res.status(404).json({ error: 'Innings not found' });
  if (innings.closed) return res.status(400).json({ error: 'Innings is closed' });
  const xi = xiRows(matchId);
  const battingIds = new Set(xi.filter((x) => x.team_id === innings.batting_team_id).map((x) => x.player_id));
  const bowlingIds = new Set(xi.filter((x) => x.team_id === innings.bowling_team_id).map((x) => x.player_id));
  const strikerId = Number(req.body?.strikerId);
  const nonStrikerId = Number(req.body?.nonStrikerId);
  const bowlerId = Number(req.body?.bowlerId);
  if (!battingIds.has(strikerId) || !battingIds.has(nonStrikerId)) {
    return res.status(400).json({ error: 'Openers must be from the batting side' });
  }
  if (strikerId === nonStrikerId) return res.status(400).json({ error: 'Openers must be two different players' });
  if (!bowlingIds.has(bowlerId)) return res.status(400).json({ error: 'Bowler must be from the bowling side' });
  const existing = inningsTotals(innings.id);
  if (existing.balls > 0) return res.status(400).json({ error: 'Openers are already set for this innings' });
  db.prepare(
    'UPDATE innings SET current_striker_id = ?, current_non_striker_id = ?, current_bowler_id = ? WHERE id = ?'
  ).run(strikerId, nonStrikerId, bowlerId, innings.id);
  res.json(getMatchState(matchId));
});

router.post('/matches/:id/batter', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const innings = inningsFor(matchId, req.body?.inningsId);
  if (!innings) return res.status(404).json({ error: 'Innings not found' });
  if (innings.closed) return res.status(400).json({ error: 'Innings is closed' });
  const playerId = Number(req.body?.playerId);
  const xi = xiRows(matchId);
  const battingIds = new Set(xi.filter((x) => x.team_id === innings.batting_team_id).map((x) => x.player_id));
  if (!battingIds.has(playerId)) return res.status(400).json({ error: 'Player is not in the batting XI' });
  const computed = recomputeInningsState(innings.id);
  if (!computed.needsNewBatter) return res.status(400).json({ error: 'No new batter is required right now' });
  if (playerId === computed.strikerId || playerId === computed.nonStrikerId) {
    return res.status(400).json({ error: 'That player is already at the crease' });
  }
  const dismissedElsewhere = db
    .prepare('SELECT 1 FROM deliveries WHERE innings_id = ? AND is_wicket = 1 AND dismissed_id = ?')
    .get(innings.id, playerId);
  if (dismissedElsewhere) return res.status(400).json({ error: 'That player is already out' });
  if (computed.strikerId == null) {
    db.prepare('UPDATE innings SET current_striker_id = ? WHERE id = ?').run(playerId, innings.id);
  } else {
    db.prepare('UPDATE innings SET current_non_striker_id = ? WHERE id = ?').run(playerId, innings.id);
  }
  res.json(getMatchState(matchId));
});

router.post('/matches/:id/bowler', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const innings = inningsFor(matchId, req.body?.inningsId);
  if (!innings) return res.status(404).json({ error: 'Innings not found' });
  if (innings.closed) return res.status(400).json({ error: 'Innings is closed' });
  const playerId = Number(req.body?.playerId);
  const xi = xiRows(matchId);
  const bowlingIds = new Set(xi.filter((x) => x.team_id === innings.bowling_team_id).map((x) => x.player_id));
  if (!bowlingIds.has(playerId)) return res.status(400).json({ error: 'Player is not in the bowling XI' });
  const computed = recomputeInningsState(innings.id);
  if (computed.strikerId === playerId || computed.nonStrikerId === playerId) {
    return res.status(400).json({ error: 'A bowler cannot be one of the batters at the crease' });
  }
  const last = db.prepare('SELECT * FROM deliveries WHERE innings_id = ? ORDER BY id DESC LIMIT 1').get(innings.id);
  if (last) {
    const overLegal = db
      .prepare(
        "SELECT COUNT(*) AS n FROM deliveries WHERE innings_id = ? AND over_no = ? AND (extra_type IS NULL OR extra_type IN ('b','lb'))"
      )
      .get(innings.id, last.over_no).n;
    if (overLegal >= 6 && last.bowler_id === playerId) {
      return res.status(400).json({ error: 'A bowler cannot bowl two overs in a row' });
    }
  }
  db.prepare('UPDATE innings SET current_bowler_id = ? WHERE id = ?').run(playerId, innings.id);
  res.json(getMatchState(matchId));
});

router.post('/matches/:id/balls', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  const innings = inningsFor(matchId, req.body?.inningsId);
  if (!innings) return res.status(404).json({ error: 'Innings not found' });
  const computed = recomputeInningsState(innings.id);
  if (computed.needsNewBatter) return res.status(400).json({ error: 'Select the next batter before scoring' });
  if (computed.strikerId == null || computed.nonStrikerId == null) {
    return res.status(400).json({ error: 'Set the batters at the crease first' });
  }
  if (computed.bowlerId == null) return res.status(400).json({ error: 'Select the bowler for this over' });
  if (Number(req.body?.strikerId) !== computed.strikerId || Number(req.body?.nonStrikerId) !== computed.nonStrikerId) {
    return res.status(409).json({ error: 'Scoring state changed — refresh and try again' });
  }
  if (Number(req.body?.bowlerId) !== computed.bowlerId) {
    return res.status(409).json({ error: 'The bowler for this over is already set' });
  }
  try {
    const state = addDelivery(matchId, innings.id, req.body);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/matches/:id/undo', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const last = db.prepare('SELECT * FROM deliveries WHERE match_id = ? ORDER BY id DESC LIMIT 1').get(matchId);
  if (!last) return res.status(400).json({ error: 'Nothing to undo' });
  const innings = db.prepare('SELECT * FROM innings WHERE id = ?').get(last.innings_id);
  const later = db.prepare('SELECT COUNT(*) AS n FROM innings WHERE match_id = ? AND innings_no > ?').get(matchId, innings.innings_no).n;
  if (later > 0) return res.status(400).json({ error: 'Cannot undo into a previous innings once the next innings has begun' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM deliveries WHERE id = ?').run(last.id);
    db.prepare('UPDATE innings SET closed = 0, declared = 0 WHERE id = ?').run(innings.id);
    db.prepare(
      "UPDATE matches SET status = 'live', winner_team_id = NULL, result_type = NULL, result_text = NULL, team_a_points = 0, team_b_points = 0, completed_at = NULL WHERE id = ?"
    ).run(matchId);
  });
  tx();
  recomputeInningsState(innings.id);
  const remaining = inningsTotals(innings.id);
  if (remaining.balls === 0 && db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE innings_id = ?').get(innings.id).n === 0) {
    db.prepare('UPDATE innings SET current_striker_id = NULL, current_non_striker_id = NULL, current_bowler_id = NULL WHERE id = ?').run(innings.id);
  }
  res.json(getMatchState(matchId));
});

router.post('/matches/:id/end-innings', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (!['test', 'custom'].includes(match.format)) {
    return res.status(400).json({ error: 'Declarations are only available in Test and Custom formats' });
  }
  const innings = inningsFor(matchId, req.body?.inningsId);
  if (!innings) return res.status(404).json({ error: 'Innings not found' });
  if (innings.closed) return res.status(400).json({ error: 'Innings already closed' });
  const state = closeInnings(matchId, innings.id, { declared: true });
  res.json(state);
});

router.post('/matches/:id/abandon', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.stage === 'playoff') return res.status(400).json({ error: 'Playoff matches cannot be abandoned' });
  if (match.status === 'completed') return res.status(400).json({ error: 'Match already completed' });
  const isLeague = match.stage === 'league';
  db.prepare(
    `UPDATE matches SET status = 'abandoned', winner_team_id = NULL, result_type = 'no_result',
       result_text = 'No result', team_a_points = ?, team_b_points = ?, completed_at = ? WHERE id = ?`
  ).run(isLeague ? 1 : 0, isLeague ? 1 : 0, now(), matchId);
  db.prepare('DELETE FROM innings WHERE match_id = ? AND id NOT IN (SELECT DISTINCT innings_id FROM deliveries)').run(matchId);
  res.json(getMatchState(matchId));
});

router.patch('/matches/:id', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status !== 'scheduled') return res.status(400).json({ error: 'Only scheduled matches can be edited' });
  const a = req.body?.teamAId != null ? Number(req.body.teamAId) : match.team_a_id;
  const b = req.body?.teamBId != null ? Number(req.body.teamBId) : match.team_b_id;
  if (!a || !b || a === b) return res.status(400).json({ error: 'Pick two different teams' });
  db.prepare('UPDATE matches SET team_a_id = ?, team_b_id = ?, venue = ?, scheduled_at = ? WHERE id = ?').run(
    a,
    b,
    req.body?.venue !== undefined ? req.body.venue || null : match.venue,
    req.body?.scheduledAt !== undefined ? req.body.scheduledAt || null : match.scheduled_at,
    matchId
  );
  res.json(matchWithNames(matchId));
});

router.delete('/matches/:id', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status !== 'scheduled') return res.status(400).json({ error: 'Only scheduled matches can be deleted' });
  db.prepare('DELETE FROM matches WHERE id = ?').run(matchId);
  res.json({ deleted: true });
});

export default router;
