import { createRouter } from '../router.js';
import { db, getSetting } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  leaderboards,
  pointsTable,
  seasonAwards,
  globalRecords,
  aggregateStats,
  formatLabel,
  getInningsRows,
  inningsTotals,
  oversText,
} from '../engine.js';

const router = createRouter();
router.use(requireAuth);

router.get('/stats/overview', async (req, res) => {
  const counts = {
    teams: (await db.prepare('SELECT COUNT(*) AS n FROM teams WHERE is_active = 1').get()).n,
    players: (await db.prepare('SELECT COUNT(*) AS n FROM players WHERE is_active = 1').get()).n,
    seasons: (await db.prepare('SELECT COUNT(*) AS n FROM seasons').get()).n,
    matches: (await db.prepare('SELECT COUNT(*) AS n FROM matches').get()).n,
    completed: (await db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status = 'completed'").get()).n,
    live: (await db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status = 'live'").get()).n,
  };
  const matchSelect = `
    SELECT m.*, ta.name AS team_a_name, ta.short_name AS team_a_short, ta.color AS team_a_color,
           tb.name AS team_b_name, tb.short_name AS team_b_short, tb.color AS team_b_color, s.name AS season_name
    FROM matches m
    LEFT JOIN teams ta ON ta.id = m.team_a_id
    LEFT JOIN teams tb ON tb.id = m.team_b_id
    LEFT JOIN seasons s ON s.id = m.season_id`;
  const liveMatches = await db
    .prepare(`${matchSelect} WHERE m.status = 'live' ORDER BY m.id DESC LIMIT 6`)
    .all();
  const upcoming = await db
    .prepare(`${matchSelect} WHERE m.status = 'scheduled' ORDER BY m.scheduled_at IS NULL, m.scheduled_at, m.id LIMIT 6`)
    .all();
  const recent = await db
    .prepare(`${matchSelect} WHERE m.status = 'completed' ORDER BY m.completed_at DESC, m.id DESC LIMIT 6`)
    .all();

  const withScores = async (rows) => {
    const out = [];
    for (const m of rows) {
      const summary = [];
      for (const inn of await getInningsRows(m.id)) {
        const totals = await inningsTotals(inn.id);
        summary.push({
          ...inn,
          ...totals,
          overs: oversText(totals.balls),
          battingTeam: await db.prepare('SELECT id, name, short_name FROM teams WHERE id = ?').get(inn.batting_team_id),
        });
      }
      out.push({ ...m, summary });
    }
    return out;
  };

  const activeSeason =
    await db.prepare("SELECT * FROM seasons WHERE status IN ('live','fixtures','playoffs') ORDER BY id DESC LIMIT 1").get() ||
    await db.prepare('SELECT * FROM seasons ORDER BY id DESC LIMIT 1').get() ||
    null;

  // ?seasonId=<id> scopes every panel to one season; ?seasonId=all aggregates every season.
  const seasonParam = String(req.query.seasonId ?? '').trim();
  const wantsAll = seasonParam === 'all' || req.query.all === '1';
  let selectedSeason = activeSeason;
  if (wantsAll) selectedSeason = null;
  else if (seasonParam) {
    selectedSeason = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(seasonParam)) || activeSeason;
  }
  const scopeSeasonId = wantsAll ? null : selectedSeason?.id ?? null;

  const seasonLeaders = await leaderboards({ seasonId: scopeSeasonId, limit: 5 });
  const standings = wantsAll ? await allTimeTable() : selectedSeason ? await pointsTable(selectedSeason.id) : [];
  const awards = wantsAll ? null : selectedSeason ? await seasonAwards(selectedSeason.id) : null;
  const seasonList = (
    await db.prepare('SELECT * FROM seasons ORDER BY id DESC').all()
  ).map((s) => ({ ...s, formatLabel: formatLabel(s) }));

  const champions = await db
    .prepare(
      `SELECT t.id, t.name, t.short_name, t.color, COUNT(*) AS titles, MAX(s.id) AS last_title_season
       FROM seasons s JOIN teams t ON t.id = s.winner_team_id
       WHERE s.status = 'completed' AND s.winner_team_id IS NOT NULL
       GROUP BY t.id ORDER BY titles DESC, t.name`
    )
    .all();
  const records = await globalRecords();

  const seasonTotals = await aggregateStats({ seasonId: scopeSeasonId });
  const totalRuns = seasonTotals.batting.reduce((s, r) => s + r.runs, 0);
  const totalWickets = seasonTotals.bowling.reduce((s, r) => s + r.wickets, 0);

  res.json({
    leagueName: await getSetting('league_name', 'The Cricket League'),
    counts,
    liveMatches: await withScores(liveMatches),
    upcoming,
    recent: await withScores(recent),
    activeSeason: activeSeason ? { ...activeSeason, formatLabel: formatLabel(activeSeason) } : null,
    selectedSeason: scopeSeasonId
      ? seasonList.find((s) => s.id === scopeSeasonId) || null
      : { id: 'all', name: 'All seasons', formatLabel: 'Career' },
    allSeasons: !scopeSeasonId,
    seasons: seasonList,
    seasonLeaders,
    standings,
    champions,
    records: { mostRuns: records.mostRuns, mostWickets: records.mostWickets, titles: records.titles },
    seasonTotals: { runs: totalRuns, wickets: totalWickets },
    awards,
  });
});

// Aggregate every season's IPL table into one career table per team.
async function allTimeTable() {
  const merged = new Map();
  const seasons = await db.prepare('SELECT id FROM seasons').all();
  for (const { id } of seasons) {
    for (const row of await pointsTable(id)) {
      const cur = merged.get(row.teamId) || {
        teamId: row.teamId,
        name: row.name,
        shortName: row.shortName,
        color: row.color,
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        noResult: 0,
        points: 0,
        runsFor: 0,
        ballsFor: 0,
        runsAgainst: 0,
        ballsAgainst: 0,
        seasons: 0,
        titles: 0,
        form: [],
      };
      cur.played += row.played;
      cur.won += row.won;
      cur.lost += row.lost;
      cur.tied += row.tied;
      cur.noResult += row.noResult;
      cur.points += row.points;
      cur.runsFor += row.runsFor;
      cur.ballsFor += row.ballsFor;
      cur.runsAgainst += row.runsAgainst;
      cur.ballsAgainst += row.ballsAgainst;
      if (row.played > 0) cur.seasons += 1;
      merged.set(row.teamId, cur);
    }
  }
  const titles = await db
    .prepare("SELECT winner_team_id, COUNT(*) AS n FROM seasons WHERE winner_team_id IS NOT NULL GROUP BY winner_team_id")
    .all();
  for (const t of titles) if (merged.has(t.winner_team_id)) merged.get(t.winner_team_id).titles = t.n;

  return [...merged.values()]
    .map((row) => {
      const oversFor = row.ballsFor / 6;
      const oversAgainst = row.ballsAgainst / 6;
      const nrr = oversFor > 0 && oversAgainst > 0 ? row.runsFor / oversFor - row.runsAgainst / oversAgainst : 0;
      return { ...row, nrr: Math.round(nrr * 1000) / 1000 };
    })
    .sort((a, b) => b.points - a.points || b.nrr - a.nrr || b.won - a.won);
}

router.get('/stats/leaderboards', async (req, res) => {
  const seasonId = req.query.seasonId ? Number(req.query.seasonId) : null;
  const teamId = req.query.teamId ? Number(req.query.teamId) : null;
  const limit = Math.min(200, Number(req.query.limit) || 10);
  res.json(await leaderboards({ seasonId, teamId, limit }));
});

router.get('/stats/records', async (req, res) => {
  const sid = req.query.seasonId && req.query.seasonId !== 'all' ? Number(req.query.seasonId) : null;
  const limit = Math.min(100, Math.max(5, Number(req.query.limit) || 10));
  const records = await globalRecords(sid, limit);
  const seasonAwards = await db
    .prepare("SELECT s.id, s.name, s.format, s.winner_team_id, t.name AS winner_name, t.short_name AS winner_short FROM seasons s LEFT JOIN teams t ON t.id = s.winner_team_id WHERE s.status = 'completed' ORDER BY s.id DESC")
    .all();
  res.json({ ...records, seasonAwards, selectedSeasonId: sid });
});

export default router;
