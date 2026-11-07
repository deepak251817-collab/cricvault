import express from 'express';
import { db, now, hashPassword } from '../db.js';
import { requireAuth, requireAdmin, sameTeamOnly } from '../auth.js';
import { teamAnalytics, playerCareer, seasonAwards, pointsTable } from '../engine.js';

const router = express.Router();
router.use(requireAuth);

const SQUAD_LIMIT = 12;

// A team can only ever field one captain, so appointing one clears the rest.
function clearOtherCaptains(seasonId, teamId, keepPlayerId = -1) {
  db.prepare('UPDATE season_players SET is_captain = 0 WHERE season_id = ? AND team_id = ? AND player_id != ?').run(
    seasonId,
    teamId,
    keepPlayerId
  );
}

function squadGuard(seasonId, teamId, playerId) {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) throw Object.assign(new Error('Season not found'), { status: 404 });
  const inSeason = db.prepare('SELECT 1 FROM season_teams WHERE season_id = ? AND team_id = ?').get(seasonId, teamId);
  if (!inSeason) throw Object.assign(new Error('Team is not part of this season'), { status: 400 });
  const count = db.prepare('SELECT COUNT(*) AS n FROM season_players WHERE season_id = ? AND team_id = ?').get(seasonId, teamId).n;
  if (count >= SQUAD_LIMIT) throw Object.assign(new Error(`Squad is full (maximum ${SQUAD_LIMIT} players)`), { status: 400 });
  const existing = db.prepare('SELECT * FROM season_players WHERE season_id = ? AND player_id = ?').get(seasonId, playerId);
  if (existing) throw Object.assign(new Error('Player is already in a squad this season'), { status: 400 });
}

/* ------------------------------- teams ------------------------------- */

router.get('/teams', (req, res) => {
  const includeInactive = req.query.all === '1' && req.user.role === 'admin';
  const teams = db
    .prepare(`SELECT * FROM teams ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY name`)
    .all();
  const stats = db
    .prepare(
      `SELECT t.id,
              (SELECT COUNT(DISTINCT sp.player_id) FROM season_players sp WHERE sp.team_id = t.id) AS squad_players,
              (SELECT COUNT(*) FROM seasons s WHERE s.winner_team_id = t.id) AS titles,
              (SELECT COUNT(*) FROM season_teams st WHERE st.team_id = t.id) AS season_count
       FROM teams t`
    )
    .all();
  const byId = new Map(stats.map((s) => [s.id, s]));
  res.json(
    teams.map((t) => ({
      ...t,
      playerCount: byId.get(t.id)?.squad_players || 0,
      titles: byId.get(t.id)?.titles || 0,
      seasonCount: byId.get(t.id)?.season_count || 0,
    }))
  );
});

router.post('/teams', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const shortName = String(req.body?.shortName || '').trim().toUpperCase();
  if (!name) return res.status(400).json({ error: 'Team name is required' });
  if (!shortName) return res.status(400).json({ error: 'Short name is required' });
  if (shortName.length > 6) return res.status(400).json({ error: 'Short name must be 6 characters or fewer' });
  const dup = db.prepare('SELECT id FROM teams WHERE name = ? COLLATE NOCASE OR short_name = ? COLLATE NOCASE').get(name, shortName);
  if (dup) return res.status(400).json({ error: 'A team with that name or short name already exists' });
  const info = db
    .prepare('INSERT INTO teams (name, short_name, color, home_ground, is_active, created_at) VALUES (?,?,?,?,1,?)')
    .run(name, shortName, req.body?.color || '#2f6b3f', req.body?.homeGround || null, now());
  const id = info.lastInsertRowid;
  const seasonId = Number(req.body?.seasonId || 0);
  if (seasonId) {
    const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(seasonId);
    if (season) db.prepare('INSERT OR IGNORE INTO season_teams (season_id, team_id, added_at) VALUES (?,?,?)').run(seasonId, id, now());
  }
  res.status(201).json(db.prepare('SELECT * FROM teams WHERE id = ?').get(id));
});

router.patch('/teams/:id', requireAdmin, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(req.params.id));
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const name = req.body?.name != null ? String(req.body.name).trim() : team.name;
  const shortName = req.body?.shortName != null ? String(req.body.shortName).trim().toUpperCase() : team.short_name;
  const dup = db
    .prepare('SELECT id FROM teams WHERE id != ? AND (name = ? COLLATE NOCASE OR short_name = ? COLLATE NOCASE)')
    .get(team.id, name, shortName);
  if (dup) return res.status(400).json({ error: 'Another team already uses that name or short name' });
  db.prepare('UPDATE teams SET name = ?, short_name = ?, color = ?, home_ground = ?, is_active = ? WHERE id = ?').run(
    name,
    shortName,
    req.body?.color ?? team.color,
    req.body?.homeGround ?? team.home_ground,
    req.body?.isActive != null ? (req.body.isActive ? 1 : 0) : team.is_active,
    team.id
  );
  res.json(db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id));
});

router.delete('/teams/:id', requireAdmin, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(req.params.id));
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const refs = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM season_teams WHERE team_id = ?)
            + (SELECT COUNT(*) FROM season_players WHERE team_id = ?)
            + (SELECT COUNT(*) FROM matches WHERE team_a_id = ? OR team_b_id = ?) AS n`
    )
    .get(team.id, team.id, team.id, team.id).n;
  if (refs > 0) {
    db.prepare('UPDATE teams SET is_active = 0 WHERE id = ?').run(team.id);
    return res.json({ archived: true, message: 'Team archived. Season history is untouched.' });
  }
  db.prepare('DELETE FROM teams WHERE id = ?').run(team.id);
  res.json({ deleted: true });
});

router.post('/teams/:id/credentials', requireAdmin, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(req.params.id));
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (password && password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const existing = db.prepare('SELECT * FROM users WHERE team_id = ?').get(team.id);
  const clash = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, existing?.id || 0);
  if (clash) return res.status(400).json({ error: 'That username is taken' });
  if (existing) {
    db.prepare('UPDATE users SET username = ?, display_name = ? WHERE id = ?').run(username, team.name, existing.id);
    if (password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), existing.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
    }
    return res.json({ username, updated: true });
  }
  if (!password) return res.status(400).json({ error: 'Password is required for a new login' });
  db.prepare(
    "INSERT INTO users (username, password_hash, role, team_id, display_name, created_at) VALUES (?,?,'team',?,?,?)"
  ).run(username, hashPassword(password), team.id, team.name, now());
  res.status(201).json({ username, created: true });
});

router.get('/teams/:id/credentials', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT username, created_at FROM users WHERE team_id = ?').get(Number(req.params.id));
  res.json({ user: user || null });
});

router.get('/teams/:id', requireAuth, sameTeamOnly, (req, res) => {
  const teamId = Number(req.params.id);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const seasons = db
    .prepare(
      `SELECT s.* FROM season_teams st JOIN seasons s ON s.id = st.season_id
       WHERE st.team_id = ? ORDER BY s.id DESC`
    )
    .all(teamId);
  const titles = db
    .prepare('SELECT s.* FROM seasons s WHERE s.winner_team_id = ? ORDER BY s.id DESC')
    .all(teamId);
  res.json({ team, seasons, titles });
});

router.get('/teams/:id/analytics', requireAuth, sameTeamOnly, (req, res) => {
  const raw = String(req.query.seasonId ?? '').trim();
  const seasonId = raw === 'all' ? 'all' : raw ? Number(raw) : null;
  const data = teamAnalytics(Number(req.params.id), seasonId);
  if (!data) return res.status(404).json({ error: 'Team not found' });
  res.json(data);
});

// One compact record per season, so a team page can show every season at once.
router.get('/teams/:id/seasons', requireAuth, sameTeamOnly, (req, res) => {
  const teamId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) {
    return res.status(404).json({ error: 'Team not found' });
  }
  const seasons = db
    .prepare(
      `SELECT s.* FROM season_teams st JOIN seasons s ON s.id = st.season_id
       WHERE st.team_id = ? ORDER BY s.created_at DESC, s.id DESC`
    )
    .all(teamId);
  const rows = seasons.map((s) => {
    const played = db
      .prepare(
        "SELECT * FROM matches WHERE season_id = ? AND status = 'completed' AND (team_a_id = ? OR team_b_id = ?)"
      )
      .all(s.id, teamId, teamId);
    let won = 0;
    let lost = 0;
    let tied = 0;
    for (const m of played) {
      if (!m.winner_team_id) tied += 1;
      else if (m.winner_team_id === teamId) won += 1;
      else lost += 1;
    }
    const table = pointsTable(s.id).find((r) => r.teamId === teamId) || null;
    return {
      id: s.id,
      name: s.name,
      format: s.format,
      status: s.status,
      startsOn: s.starts_on,
      champion: s.winner_team_id === teamId,
      squad: db.prepare('SELECT COUNT(*) AS n FROM season_players WHERE season_id = ? AND team_id = ?').get(s.id, teamId).n,
      played: played.length,
      won,
      lost,
      tied,
      points: table?.points ?? 0,
      position: table?.position ?? null,
      nrr: table?.nrr ?? 0,
    };
  });
  res.json(rows);
});

/* ------------------------------ players ------------------------------ */

router.get('/players', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const seasonId = req.query.seasonId ? Number(req.query.seasonId) : null;
  const teamId = req.query.teamId ? Number(req.query.teamId) : null;
  const includeInactive = req.query.all === '1';

  if (seasonId) {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.role, p.batting_style, p.bowl_style, p.is_active,
                sp.team_id, sp.is_captain, sp.is_wicketkeeper, t.name AS team_name, t.short_name AS team_short
         FROM players p
         LEFT JOIN season_players sp ON sp.player_id = p.id AND sp.season_id = ?
         LEFT JOIN teams t ON t.id = sp.team_id
         WHERE (? = '' OR p.name LIKE '%' || ? || '%')
         ${teamId ? 'AND sp.team_id = ?' : ''}
         ORDER BY (sp.id IS NULL), p.name`
      )
      .all(...(teamId ? [seasonId, q, q, teamId] : [seasonId, q, q]));
    return res.json(rows);
  }

  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.role, p.batting_style, p.bowl_style, p.is_active,
              (SELECT t.name FROM season_players sp JOIN teams t ON t.id = sp.team_id
               JOIN seasons s ON s.id = sp.season_id
               WHERE sp.player_id = p.id ORDER BY s.created_at DESC, s.id DESC LIMIT 1) AS team_name,
              (SELECT t.short_name FROM season_players sp JOIN teams t ON t.id = sp.team_id
               JOIN seasons s ON s.id = sp.season_id
               WHERE sp.player_id = p.id ORDER BY s.created_at DESC, s.id DESC LIMIT 1) AS team_short,
              (SELECT sp.is_wicketkeeper FROM season_players sp JOIN seasons s ON s.id = sp.season_id
               WHERE sp.player_id = p.id ORDER BY s.created_at DESC, s.id DESC LIMIT 1) AS is_wicketkeeper,
              (SELECT sp.is_captain FROM season_players sp JOIN seasons s ON s.id = sp.season_id
               WHERE sp.player_id = p.id ORDER BY s.created_at DESC, s.id DESC LIMIT 1) AS is_captain
       FROM players p
       WHERE (? = '' OR p.name LIKE '%' || ? || '%') ${includeInactive ? '' : 'AND p.is_active = 1'}
       ORDER BY p.name`
    )
    .all(q, q);
  res.json(rows);
});

router.post('/players', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Player name is required' });
  const role = ['batter', 'bowler', 'allrounder', 'wicketkeeper'].includes(req.body?.role) ? req.body.role : 'batter';
  const bowlStyle = ['fast', 'medium', 'spin'].includes(req.body?.bowlStyle) ? req.body.bowlStyle : null;
  const battingStyle = ['right', 'left'].includes(req.body?.battingStyle) ? req.body.battingStyle : null;
  const dup = db.prepare('SELECT id FROM players WHERE name = ? COLLATE NOCASE').get(name);
  if (dup) return res.status(400).json({ error: 'A player with that name already exists' });

  const seasonId = Number(req.body?.seasonId || 0);
  const teamId = Number(req.body?.teamId || 0);
  if (seasonId && teamId) {
    try {
      squadGuard(seasonId, teamId, -1);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }

  const info = db
    .prepare('INSERT INTO players (name, role, bowl_style, batting_style, is_active, created_at) VALUES (?,?,?,?,1,?)')
    .run(name, role, bowlStyle, battingStyle, now());
  const playerId = info.lastInsertRowid;
  if (seasonId && teamId) {
    const isCaptain = req.body?.isCaptain ? 1 : 0;
    db.transaction(() => {
      if (isCaptain) clearOtherCaptains(seasonId, teamId, playerId);
      db.prepare(
        'INSERT INTO season_players (season_id, team_id, player_id, is_captain, is_wicketkeeper, added_at) VALUES (?,?,?,?,?,?)'
      ).run(
        seasonId,
        teamId,
        playerId,
        isCaptain,
        req.body?.isWicketkeeper || role === 'wicketkeeper' ? 1 : 0,
        now()
      );
    })();
  }
  res.status(201).json(db.prepare('SELECT * FROM players WHERE id = ?').get(playerId));
});

router.patch('/players/:id', requireAdmin, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(req.params.id));
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const name = req.body?.name != null ? String(req.body.name).trim() : player.name;
  if (!name) return res.status(400).json({ error: 'Player name is required' });
  const dup = db.prepare('SELECT id FROM players WHERE name = ? COLLATE NOCASE AND id != ?').get(name, player.id);
  if (dup) return res.status(400).json({ error: 'Another player already has that name' });
  db.prepare('UPDATE players SET name = ?, role = ?, bowl_style = ?, batting_style = ?, is_active = ? WHERE id = ?').run(
    name,
    ['batter', 'bowler', 'allrounder', 'wicketkeeper'].includes(req.body?.role) ? req.body.role : player.role,
    req.body?.bowlStyle !== undefined
      ? ['fast', 'medium', 'spin'].includes(req.body.bowlStyle)
        ? req.body.bowlStyle
        : null
      : player.bowl_style,
    req.body?.battingStyle !== undefined
      ? ['right', 'left'].includes(req.body.battingStyle)
        ? req.body.battingStyle
        : null
      : player.batting_style,
    req.body?.isActive != null ? (req.body.isActive ? 1 : 0) : player.is_active,
    player.id
  );
  res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(player.id));
});

/* Deletes a player nothing refers to, archives one that appears in a squad, XI or scorecard.
   Returns 'deleted' | 'archived', or null when the player no longer exists. */
function removeOnePlayer(id) {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(id));
  if (!player) return null;
  const refs = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM deliveries WHERE batter_id = ? OR bowler_id = ? OR dismissed_id = ?)
            + (SELECT COUNT(*) FROM season_players WHERE player_id = ?) + (SELECT COUNT(*) FROM match_xi WHERE player_id = ?) AS n`
    )
    .get(player.id, player.id, player.id, player.id, player.id).n;
  if (refs > 0) {
    db.prepare('UPDATE players SET is_active = 0 WHERE id = ?').run(player.id);
    return 'archived';
  }
  db.prepare('DELETE FROM players WHERE id = ?').run(player.id);
  return 'deleted';
}

router.delete('/players/:id', requireAdmin, (req, res) => {
  const result = removeOnePlayer(req.params.id);
  if (!result) return res.status(404).json({ error: 'Player not found' });
  if (result === 'archived') return res.json({ archived: true, message: 'Player archived to preserve scorecards.' });
  res.json({ deleted: true });
});

router.post('/players/bulk-delete', requireAdmin, (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!raw || !raw.length) return res.status(400).json({ error: 'Select at least one player to delete' });
  const ids = [...new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return res.status(400).json({ error: 'Select at least one player to delete' });
  const summary = { deleted: 0, archived: 0, missing: 0 };
  db.transaction(() => {
    for (const id of ids) {
      const result = removeOnePlayer(id);
      if (result === null) summary.missing += 1;
      else summary[result] += 1;
    }
  })();
  res.json(summary);
});

router.get('/players/:id', requireAuth, (req, res) => {
  const data = playerCareer(Number(req.params.id));
  if (!data) return res.status(404).json({ error: 'Player not found' });
  res.json(data);
});

/* --------------------------- season squad --------------------------- */

router.get('/seasons/:id/squad/:teamId', requireAuth, (req, res) => {
  const seasonId = Number(req.params.id);
  const teamId = Number(req.params.teamId);
  const squad = db
    .prepare(
      `SELECT sp.*, p.name, p.role, p.batting_style, p.bowl_style
       FROM season_players sp JOIN players p ON p.id = sp.player_id
       WHERE sp.season_id = ? AND sp.team_id = ? ORDER BY p.name`
    )
    .all(seasonId, teamId);
  res.json({ squad, limit: SQUAD_LIMIT, season: db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId) });
});

router.post('/seasons/:id/squad', requireAdmin, (req, res) => {
  const seasonId = Number(req.params.id);
  const teamId = Number(req.body?.teamId);
  let playerId = Number(req.body?.playerId || 0);
  if (!teamId) return res.status(400).json({ error: 'Team is required' });
  try {
    if (!playerId) {
      const name = String(req.body?.playerName || '').trim();
      if (!name) return res.status(400).json({ error: 'Pick a player or enter a new player name' });
      const dup = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(name);
      if (dup) playerId = dup.id;
      else {
        const info = db
          .prepare("INSERT INTO players (name, role, bowl_style, batting_style, is_active, created_at) VALUES (?,?,?,?,1,?)")
          .run(
            name,
            ['batter', 'bowler', 'allrounder', 'wicketkeeper'].includes(req.body?.role) ? req.body.role : 'batter',
            ['fast', 'medium', 'spin'].includes(req.body?.bowlStyle) ? req.body.bowlStyle : null,
            ['right', 'left'].includes(req.body?.battingStyle) ? req.body.battingStyle : null,
            now()
          );
        playerId = info.lastInsertRowid;
      }
    }
    squadGuard(seasonId, teamId, playerId);
    const isWk = req.body?.isWicketkeeper ? 1 : 0;
    const isCaptain = req.body?.isCaptain ? 1 : 0;
    db.transaction(() => {
      if (isCaptain) clearOtherCaptains(seasonId, teamId, playerId);
      db.prepare(
        'INSERT INTO season_players (season_id, team_id, player_id, is_captain, is_wicketkeeper, added_at) VALUES (?,?,?,?,?,?)'
      ).run(seasonId, teamId, playerId, isCaptain, isWk, now());
    })();
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  res.status(201).json(
    db
      .prepare('SELECT sp.*, p.name, p.role FROM season_players sp JOIN players p ON p.id = sp.player_id WHERE sp.season_id = ? AND sp.player_id = ?')
      .get(seasonId, playerId)
  );
});

router.patch('/seasons/:id/squad/:playerId', (req, res) => {
  const seasonId = Number(req.params.id);
  const playerId = Number(req.params.playerId);
  const row = db.prepare('SELECT * FROM season_players WHERE season_id = ? AND player_id = ?').get(seasonId, playerId);
  if (!row) return res.status(404).json({ error: 'Player is not in this season squad' });
  // Admin runs the league; a team login may manage the flags on its own squad.
  const isAdmin = req.user?.role === 'admin';
  const isTeamManager = req.user?.role === 'team' && Number(req.user?.team_id) === Number(row.team_id);
  if (!isAdmin && !isTeamManager) {
    return res.status(403).json({ error: 'You can only manage your own squad' });
  }
  const nextCaptain =
    req.body?.isCaptain != null ? (req.body.isCaptain ? 1 : 0) : row.is_captain;
  const nextKeeper =
    req.body?.isWicketkeeper != null ? (req.body.isWicketkeeper ? 1 : 0) : row.is_wicketkeeper;
  db.transaction(() => {
    if (nextCaptain) clearOtherCaptains(seasonId, row.team_id, row.player_id);
    db.prepare('UPDATE season_players SET is_captain = ?, is_wicketkeeper = ? WHERE id = ?').run(
      nextCaptain,
      nextKeeper,
      row.id
    );
  })();
  res.json(db.prepare('SELECT * FROM season_players WHERE id = ?').get(row.id));
});

router.delete('/seasons/:id/squad/:playerId', (req, res) => {
  const seasonId = Number(req.params.id);
  const playerId = Number(req.params.playerId);
  const row = db
    .prepare('SELECT * FROM season_players WHERE season_id = ? AND player_id = ?')
    .get(seasonId, playerId);
  if (!row) return res.status(404).json({ error: 'Player not found in squad' });
  if (req.user?.role !== 'admin' && Number(req.user?.team_id) !== Number(row.team_id)) {
    return res.status(403).json({ error: 'You can only remove players from your own team' });
  }
  db.prepare('DELETE FROM season_players WHERE season_id = ? AND player_id = ?').run(seasonId, playerId);
  res.json({ deleted: true, teamId: row.team_id });
});

export default router;
