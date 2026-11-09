import { createRouter } from '../router.js';
import { db, now } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { formatLabel } from '../engine.js';

/**
 * Season backup / restore.
 *
 * A backup is a plain JSON archive of one season: the season row, its teams,
 * the players who appear in its squads or scorecards, the squads themselves,
 * every fixture, and the complete ball-by-ball log. Because the delivery log
 * is the single source of truth for the scorecard, restoring the archive
 * restores the season exactly as it was — tables, awards and stats included.
 */

const router = createRouter();
router.use(requireAuth);

const KIND = 'season-backup';
const VERSION = 1;

const TEAM_FIELDS = ['name', 'short_name', 'color', 'home_ground', 'logo', 'is_active', 'created_at'];
const PLAYER_FIELDS = ['name', 'role', 'bowl_style', 'batting_style', 'is_active', 'created_at'];
const SEASON_FIELDS = [
  'format',
  'overs_per_innings',
  'innings_limit',
  'status',
  'playoff_teams',
  'winner_team_id',
  'runner_up_team_id',
  'starts_on',
  'notes',
  'created_at',
];
const MATCH_FIELDS = [
  'stage',
  'match_no',
  'stage_name',
  'team_a_id',
  'team_b_id',
  'venue',
  'scheduled_at',
  'status',
  'format',
  'overs',
  'innings_limit',
  'toss_winner_id',
  'toss_decision',
  'winner_team_id',
  'result_type',
  'result_text',
  'team_a_points',
  'team_b_points',
  'bracket_key',
  'seed_a',
  'seed_b',
  'winner_to',
  'loser_to',
  'created_at',
  'completed_at',
];
const INNINGS_FIELDS = [
  'innings_no',
  'batting_team_id',
  'bowling_team_id',
  'target',
  'declared',
  'closed',
  'current_striker_id',
  'current_non_striker_id',
  'current_bowler_id',
  'created_at',
];
const DELIVERY_FIELDS = [
  'over_no',
  'ball_no',
  'batter_id',
  'non_striker_id',
  'bowler_id',
  'runs',
  'extra_type',
  'extra_runs',
  'is_wicket',
  'wicket_type',
  'dismissed_id',
  'fielder_id',
  'created_at',
];

const slugify = (text) =>
  String(text || 'season')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'season';

async function seasonArchive(seasonId) {
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return null;

  const teams = await db
    .prepare(
      `SELECT t.* FROM season_teams st JOIN teams t ON t.id = st.team_id
       WHERE st.season_id = ? ORDER BY t.name`
    )
    .all(seasonId);

  const seasonPlayers = await db
    .prepare('SELECT * FROM season_players WHERE season_id = ? ORDER BY id')
    .all(seasonId);

  const matches = await db
    .prepare('SELECT * FROM matches WHERE season_id = ? ORDER BY id')
    .all(seasonId);
  const matchIds = matches.map((m) => m.id);

  const innings = [];
  const deliveries = [];
  const matchXi = [];
  if (matchIds.length) {
    const placeholders = matchIds.map(() => '?').join(',');
    innings.push(...db.prepare(`SELECT * FROM innings WHERE match_id IN (${placeholders}) ORDER BY id`).all(...matchIds));
    deliveries.push(...db.prepare(`SELECT * FROM deliveries WHERE match_id IN (${placeholders}) ORDER BY id`).all(...matchIds));
    matchXi.push(...db.prepare(`SELECT * FROM match_xi WHERE match_id IN (${placeholders}) ORDER BY match_id, player_id`).all(...matchIds));
  }

  // Every player the archive refers to, so a restore never depends on ids that
  // no longer exist (players can be deleted after a season ends).
  const playerIds = new Set(seasonPlayers.map((row) => row.player_id));
  for (const d of deliveries) {
    for (const key of ['batter_id', 'non_striker_id', 'bowler_id', 'dismissed_id', 'fielder_id']) {
      if (d[key]) playerIds.add(d[key]);
    }
  }
  for (const row of matchXi) if (row.player_id) playerIds.add(row.player_id);
  for (const i of innings) {
    for (const key of ['current_striker_id', 'current_non_striker_id', 'current_bowler_id']) {
      if (i[key]) playerIds.add(i[key]);
    }
  }

  const players = [];
  for (const id of playerIds) {
    const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(id);
    if (player) players.push(player);
  }
  players.sort((a, b) => a.id - b.id);

  return {
    app: 'CricVault',
    kind: KIND,
    version: VERSION,
    exportedAt: now(),
    counts: {
      teams: teams.length,
      players: players.length,
      squads: seasonPlayers.length,
      matches: matches.length,
      innings: innings.length,
      deliveries: deliveries.length,
    },
    season: { ...season, formatLabel: formatLabel(season) },
    teams,
    players,
    seasonTeams: teams.map((t) => ({ team_id: t.id })),
    seasonPlayers,
    matches,
    innings,
    deliveries,
    matchXi,
  };
}

router.get('/seasons/:id/export', requireAdmin, async (req, res) => {
  const seasonId = Number(req.params.id);
  const archive = await seasonArchive(seasonId);
  if (!archive) return res.status(404).json({ error: 'Season not found' });
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `cricvault-${slugify(archive.season.name)}-${stamp}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(archive));
});

/* ------------------------------ restore ------------------------------ */

async function uniqueTeamShort(name, preferred) {
  const taken = async (short) => await db.prepare('SELECT 1 FROM teams WHERE upper(short_name) = upper(?)').get(short);
  const base = String(preferred || name || 'TEAM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TEAM';
  if (!(await taken(base))) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base.slice(0, 6)}${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${base.slice(0, 4)}${Date.now().toString().slice(-4)}`;
}

async function uniqueSeasonName(base) {
  const cleaned = String(base || 'Restored season').trim() || 'Restored season';
  const exists = async (name) => await db.prepare('SELECT 1 FROM seasons WHERE lower(name) = lower(?)').get(name);
  if (!(await exists(`${cleaned} (restored)`))) return `${cleaned} (restored)`;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${cleaned} (restored ${i})`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${cleaned} (restored ${new Date().toISOString().slice(0, 19)})`;
}

async function restoreArchive(raw) {
  const array = (value) => (Array.isArray(value) ? value : []);
  const teams = array(raw.teams);
  const players = array(raw.players);
  const seasonTeams = array(raw.seasonTeams ?? raw.season_teams);
  const seasonPlayers = array(raw.seasonPlayers ?? raw.season_players);
  const matches = array(raw.matches);
  const innings = array(raw.innings);
  const deliveries = array(raw.deliveries);
  const matchXi = array(raw.matchXi ?? raw.match_xi);

  const result = { teamsCreated: 0, teamsReused: 0, playersCreated: 0, matches: 0, deliveries: 0 };

  const run = db.transaction(async () => {
    /* teams */
    const teamMap = new Map();
    for (const team of teams) {
      const name = String(team.name || '').trim();
      if (!name) continue;
      const existing = await db.prepare('SELECT * FROM teams WHERE lower(name) = lower(?)').get(name);
      if (existing) {
        teamMap.set(team.id, existing.id);
        result.teamsReused += 1;
        continue;
      }
      const short = await uniqueTeamShort(name, team.short_name);
      const info = await db
        .prepare(
          `INSERT INTO teams (name, short_name, color, home_ground, logo, is_active, created_at)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(
          name,
          short,
          team.color || '#2f6b3f',
          team.home_ground || null,
          team.logo || null,
          team.is_active == null ? 1 : Number(team.is_active),
          team.created_at || now()
        );
      teamMap.set(team.id, info.lastInsertRowid);
      result.teamsCreated += 1;
    }

    /* players */
    const playerMap = new Map();
    for (const player of players) {
      const name = String(player.name || '').trim();
      if (!name) continue;
      const existing = await db.prepare('SELECT * FROM players WHERE lower(name) = lower(?) ORDER BY id LIMIT 1').get(name);
      if (existing) {
        playerMap.set(player.id, existing.id);
        continue;
      }
      const info = await db
        .prepare(
          `INSERT INTO players (name, role, bowl_style, batting_style, is_active, created_at)
           VALUES (?,?,?,?,?,?)`
        )
        .run(
          name,
          player.role || 'batter',
          player.bowl_style || null,
          player.batting_style || null,
          player.is_active == null ? 1 : Number(player.is_active),
          player.created_at || now()
        );
      playerMap.set(player.id, info.lastInsertRowid);
      result.playersCreated += 1;
    }

    /* season */
    const src = raw.season || {};
    const name = await uniqueSeasonName(src.name);
    const values = SEASON_FIELDS.map((field) => {
      if (field === 'winner_team_id' || field === 'runner_up_team_id') {
        return src[field] ? (teamMap.get(src[field]) ?? null) : null;
      }
      if (field === 'created_at') return src.created_at || now();
      return src[field] ?? null;
    });
    const seasonInfo = await db
      .prepare(
        `INSERT INTO seasons (name, ${SEASON_FIELDS.join(', ')})
         VALUES (?, ${SEASON_FIELDS.map(() => '?').join(', ')})`
      )
      .run(name, ...values);
    const seasonId = seasonInfo.lastInsertRowid;

    /* enrollment + squads */
    const enrolled = seasonTeams.length ? seasonTeams : teams.map((t) => ({ team_id: t.id }));
    for (const row of enrolled) {
      const teamId = teamMap.get(row.team_id ?? row.id);
      if (!teamId) continue;
      await db.prepare('INSERT OR IGNORE INTO season_teams (season_id, team_id, added_at) VALUES (?,?,?)').run(
        seasonId,
        teamId,
        row.added_at || now()
      );
    }
    for (const row of seasonPlayers) {
      const teamId = teamMap.get(row.team_id);
      const playerId = playerMap.get(row.player_id);
      if (!teamId || !playerId) continue;
      await db.prepare(
        `INSERT OR IGNORE INTO season_players (season_id, team_id, player_id, is_captain, is_wicketkeeper, added_at)
         VALUES (?,?,?,?,?,?)`
      ).run(
        seasonId,
        teamId,
        playerId,
        Number(row.is_captain || 0),
        Number(row.is_wicketkeeper || 0),
        row.added_at || now()
      );
    }

    /* fixtures + ball-by-ball log */
    const matchMap = new Map();
    for (const match of matches) {
      const row = MATCH_FIELDS.map((field) => {
        if (['team_a_id', 'team_b_id', 'toss_winner_id', 'winner_team_id'].includes(field)) {
          return match[field] ? (teamMap.get(match[field]) ?? null) : null;
        }
        if (field === 'created_at') return match.created_at || now();
        return match[field] ?? null;
      });
      const info = await db
        .prepare(
          `INSERT INTO matches (season_id, ${MATCH_FIELDS.join(', ')})
           VALUES (?, ${MATCH_FIELDS.map(() => '?').join(', ')})`
        )
        .run(seasonId, ...row);
      matchMap.set(match.id, info.lastInsertRowid);
      result.matches += 1;
    }

    const inningsMap = new Map();
    for (const entry of innings) {
      const matchId = matchMap.get(entry.match_id);
      if (!matchId) continue;
      const valuesInn = INNINGS_FIELDS.map((field) => {
        if (['batting_team_id', 'bowling_team_id'].includes(field)) return teamMap.get(entry[field]) ?? null;
        if (['current_striker_id', 'current_non_striker_id', 'current_bowler_id'].includes(field)) {
          return entry[field] ? (playerMap.get(entry[field]) ?? null) : null;
        }
        if (field === 'created_at') return entry.created_at || now();
        return entry[field] ?? null;
      });
      const info = await db
        .prepare(
          `INSERT INTO innings (match_id, ${INNINGS_FIELDS.join(', ')})
           VALUES (?, ${INNINGS_FIELDS.map(() => '?').join(', ')})`
        )
        .run(matchId, ...valuesInn);
      inningsMap.set(entry.id, info.lastInsertRowid);
    }

    for (const ball of deliveries) {
      const matchId = matchMap.get(ball.match_id);
      const inningsId = inningsMap.get(ball.innings_id);
      const batterId = playerMap.get(ball.batter_id);
      const bowlerId = playerMap.get(ball.bowler_id);
      if (!matchId || !inningsId || !batterId || !bowlerId) continue;
      const valuesBall = DELIVERY_FIELDS.map((field) => {
        if (field === 'batter_id') return batterId;
        if (field === 'bowler_id') return bowlerId;
        if (['non_striker_id', 'dismissed_id', 'fielder_id'].includes(field)) {
          return ball[field] ? (playerMap.get(ball[field]) ?? null) : null;
        }
        if (field === 'created_at') return ball.created_at || now();
        return ball[field] ?? null;
      });
      await db.prepare(
        `INSERT INTO deliveries (match_id, innings_id, ${DELIVERY_FIELDS.join(', ')})
         VALUES (?, ?, ${DELIVERY_FIELDS.map(() => '?').join(', ')})`
      ).run(matchId, inningsId, ...valuesBall);
      result.deliveries += 1;
    }

    for (const row of matchXi) {
      const matchId = matchMap.get(row.match_id);
      const teamId = teamMap.get(row.team_id);
      const playerId = playerMap.get(row.player_id);
      if (!matchId || !teamId || !playerId) continue;
      await db.prepare(
        'INSERT OR IGNORE INTO match_xi (match_id, team_id, player_id, is_captain, is_wk) VALUES (?,?,?,?,?)'
      ).run(matchId, teamId, playerId, Number(row.is_captain || 0), Number(row.is_wk || 0));
    }

    return { seasonId, name };
  });

  return { ...(await run()), counts: result };
}

router.post('/seasons/restore', requireAdmin, async (req, res) => {
  const raw = req.body?.backup ?? req.body ?? {};
  if (!raw || raw.kind !== KIND || !raw.season) {
    return res.status(400).json({ error: 'That file is not a CricVault season backup' });
  }
  if (Number(raw.version) > VERSION) {
    return res.status(400).json({ error: 'This backup was made by a newer version of CricVault' });
  }
  try {
    const restored = await restoreArchive(raw);
    const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(restored.seasonId);
    res.status(201).json({
      seasonId: restored.seasonId,
      name: restored.name,
      counts: restored.counts,
      season: season ? { ...season, formatLabel: formatLabel(season) } : null,
    });
  } catch (err) {
    res.status(400).json({ error: `Could not restore that backup — ${err.message}` });
  }
});

export default router;
