import { db, now, getSetting } from './db.js';

export const FORMATS = {
  t20: { label: 'T20', overs: 20, innings: 2 },
  odi: { label: 'ODI', overs: 50, innings: 2 },
  test: { label: 'Test', overs: null, innings: 4 },
  custom: { label: 'Custom', overs: null, innings: 2 },
};

export const WICKET_TYPES = [
  'bowled',
  'caught',
  'lbw',
  'stumped',
  'run out',
  'hit wicket',
  'caught and bowled',
  'retired hurt',
  'obstructing the field',
];

const BOWLER_CREDIT = new Set(['bowled', 'caught', 'lbw', 'stumped', 'hit wicket', 'caught and bowled']);

/**
 * IPL / MCC law: on a no-ball, and on the free hit that follows one, the
 * striker cannot be bowled, caught, lbw, stumped or hit wicket. The only ways
 * to lose a wicket are a run out or obstructing the field.
 */
export const FREE_HIT_WICKETS = new Set(['run out', 'obstructing the field']);
export const isFreeHitDismissal = (type) => FREE_HIT_WICKETS.has(type);

export function isLegalBall(extra) {
  return extra == null || extra === 'b' || extra === 'lb';
}

/**
 * A free hit follows every no-ball. If the free hit delivery is itself a wide
 * or a no-ball it stays a free hit, which is what `pending` carries across the
 * replay of the delivery log.
 */
export function freeHitPending(deliveries) {
  let pending = false;
  for (const d of deliveries) pending = d.extra_type === 'nb' || (pending && d.extra_type === 'wd');
  return pending;
}

export const oversText = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

export function formatLabel(season) {
  if (!season) return '';
  if (season.format === 'custom')
    return season.overs_per_innings ? `Custom · ${season.overs_per_innings} overs` : 'Custom · unlimited';
  if (season.format === 'test') return 'Test · 4 innings';
  return FORMATS[season.format]?.label || season.format;
}

/* ------------------------------------------------------------------ */
/* Ball-by-ball replay                                                 */
/* ------------------------------------------------------------------ */

export function ballLabel(d) {
  if (d.is_wicket) {
    const extra = d.extra_type
      ? d.extra_type === 'nb'
        ? (d.runs || 0) + (d.extra_runs || 0)
        : d.extra_runs || 0
      : d.runs || 0;
    return extra ? `W+${extra}` : 'W';
  }
  if (d.extra_type === 'wd') return d.extra_runs > 1 ? `${d.extra_runs}wd` : 'wd';
  if (d.extra_type === 'nb') return d.runs ? `${d.runs}nb` : 'nb';
  if (d.extra_type === 'b') return `${d.extra_runs}b`;
  if (d.extra_type === 'lb') return `${d.extra_runs}lb`;
  return String(d.runs);
}

/**
 * Rebuild an innings entirely from its delivery log. The log is the single
 * source of truth, which makes undo and corrections trivially consistent.
 */
export async function computeInnings(innings, deliveries, match) {
  let runs = 0;
  let wickets = 0;
  let balls = 0;
  let striker = innings.current_striker_id ?? null;
  let nonStriker = innings.current_non_striker_id ?? null;
  let bowler = innings.current_bowler_id ?? null;
  let legalInOver = 0;
  let overTokens = [];
  let lastOver = null;
  let freeHit = false;
  const extras = { wides: 0, noballs: 0, byes: 0, legbyes: 0 };
  const bat = new Map();
  const bowl = new Map();
  const order = [];
  const overConceded = new Map();
  const fallOfWickets = [];

  const ensureBat = (id) => {
    if (!id) return null;
    if (!bat.has(id)) {
      bat.set(id, {
        playerId: id,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        out: false,
        dismissalText: null,
        order: order.length,
      });
      order.push(id);
    }
    return bat.get(id);
  };
  const ensureBowl = (id) => {
    if (!id) return null;
    if (!bowl.has(id)) {
      bowl.set(id, { playerId: id, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noballs: 0 });
    }
    return bowl.get(id);
  };

  if (deliveries.length > 0) {
    striker = deliveries[0].batter_id;
    nonStriker = deliveries[0].non_striker_id ?? null;
  }

  for (const d of deliveries) {
    const onFreeHit = freeHit;
    ensureBat(d.batter_id);
    ensureBat(d.non_striker_id);
    const b = ensureBat(d.batter_id);
    const bw = ensureBowl(d.bowler_id);
    const legal = isLegalBall(d.extra_type);
    const total = (d.runs || 0) + (d.extra_runs || 0);
    const runExtras =
      d.extra_type === 'wd' || d.extra_type === 'nb' ? Math.max(0, (d.extra_runs || 0) - 1) : d.extra_runs || 0;

    runs += total;
    if (legal) balls += 1;
    if (d.is_wicket) {
      wickets += 1;
      fallOfWickets.push({ wicket: wickets, runs, balls, playerId: d.dismissed_id });
    }
    if (d.extra_type === 'wd') extras.wides += d.extra_runs || 0;
    else if (d.extra_type === 'nb') extras.noballs += d.extra_runs || 0;
    else if (d.extra_type === 'b') extras.byes += d.extra_runs || 0;
    else if (d.extra_type === 'lb') extras.legbyes += d.extra_runs || 0;

    if (b) {
      b.runs += d.runs || 0;
      if (d.extra_type !== 'wd') b.balls += 1;
      if (d.runs === 4) b.fours += 1;
      if (d.runs === 6) b.sixes += 1;
      if (d.is_wicket && d.dismissed_id === d.batter_id) {
        b.out = true;
        b.dismissalText = await dismissalText(d);
      }
    }

    if (bw) {
      const conceded = (d.runs || 0) + (d.extra_type === 'wd' || d.extra_type === 'nb' ? d.extra_runs || 0 : 0);
      bw.balls += legal ? 1 : 0;
      bw.runs += conceded;
      if (d.extra_type === 'wd') bw.wides += d.extra_runs || 0;
      if (d.extra_type === 'nb') bw.noballs += d.extra_runs || 0;
      if (d.is_wicket && BOWLER_CREDIT.has(d.wicket_type)) bw.wickets += 1;
    }

    striker = d.batter_id;
    nonStriker = d.non_striker_id ?? null;
    bowler = d.bowler_id;

    if (d.is_wicket) {
      if (d.dismissed_id === striker) striker = null;
      else if (d.dismissed_id === nonStriker) nonStriker = null;
    } else if (((d.runs || 0) + runExtras) % 2 === 1) {
      [striker, nonStriker] = [nonStriker, striker];
    }

    const overKey = `${d.bowler_id}:${d.over_no}`;
    overConceded.set(overKey, (overConceded.get(overKey) || 0) + (bw ? (d.runs || 0) + (d.extra_type === 'wd' || d.extra_type === 'nb' ? d.extra_runs || 0 : 0) : 0));

    if (legal) {
      legalInOver += 1;
      overTokens.push(ballLabel(d));
      if (legalInOver === 6) {
        [striker, nonStriker] = [nonStriker, striker];
        bowler = null;
        legalInOver = 0;
        lastOver = { overNo: d.over_no, tokens: overTokens };
        overTokens = [];
      }
    } else {
      overTokens.push(ballLabel(d));
    }

    freeHit = d.extra_type === 'nb' || (onFreeHit && d.extra_type === 'wd');
  }

  // maidens
  const oversByBowler = new Map();
  for (const d of deliveries) {
    if (!isLegalBall(d.extra_type)) continue;
    const key = `${d.bowler_id}:${d.over_no}`;
    oversByBowler.set(key, (oversByBowler.get(key) || 0) + 1);
  }
  for (const [key, count] of oversByBowler) {
    if (count !== 6) continue;
    const bowlerId = Number(key.split(':')[0]);
    const conceded = overConceded.get(key) || 0;
    if (conceded === 0) {
      const entry = bowl.get(bowlerId);
      if (entry) entry.maidens += 1;
    }
  }

  // Honour a batter or bowler chosen since the last delivery. Without this the
  // replayed state would keep asking for a new batter after every wicket.
  const dismissedIds = new Set(
    deliveries.filter((d) => d.is_wicket && d.dismissed_id).map((d) => d.dismissed_id)
  );
  if (striker == null && innings.current_striker_id && !dismissedIds.has(innings.current_striker_id)) {
    if (innings.current_striker_id !== nonStriker) striker = innings.current_striker_id;
  }
  if (nonStriker == null && innings.current_non_striker_id && !dismissedIds.has(innings.current_non_striker_id)) {
    if (innings.current_non_striker_id !== striker) nonStriker = innings.current_non_striker_id;
  }
  if (bowler == null && innings.current_bowler_id) bowler = innings.current_bowler_id;

  if (!innings.closed) {
    ensureBat(striker);
    ensureBat(nonStriker);
  }
  for (const id of [...bat.keys()]) if (!id) bat.delete(id);

  const batting = [...bat.values()].sort((a, b2) => a.order - b2.order);
  const bowling = [...bowl.values()];

  const target = innings.target ?? null;
  const chase = target != null ? Math.max(0, target - runs) : null;
  const matchOvers = match?.overs ?? null;
  const ballsRemaining = matchOvers ? Math.max(0, matchOvers * 6 - balls) : null;
  const crr = balls > 0 ? Number((runs / (balls / 6)).toFixed(2)) : 0;
  const rrr =
    target != null && ballsRemaining && ballsRemaining > 0
      ? Number((Math.max(0, target - runs) / (ballsRemaining / 6)).toFixed(2))
      : null;

  return {
    inningsId: innings.id,
    inningsNo: innings.innings_no,
    battingTeamId: innings.batting_team_id,
    bowlingTeamId: innings.bowling_team_id,
    runs,
    wickets,
    balls,
    overs: oversText(balls),
    extras,
    extrasTotal: extras.wides + extras.noballs + extras.byes + extras.legbyes,
    batting,
    bowling,
    strikerId: striker,
    nonStrikerId: nonStriker,
    bowlerId: bowler,
    currentOver: overTokens,
    lastOver,
    lastBalls: deliveries.slice(-12).map(ballLabel),
    target,
    chase,
    requiredRate: rrr,
    runRate: crr,
    ballsRemaining,
    fallOfWickets,
    freeHit: !innings.closed && freeHit,
    closed: !!innings.closed,
    declared: !!innings.declared,
    needsNewBatter: (striker == null || nonStriker == null) && !innings.closed && wickets < 10,
    needsNewBowler: bowler == null && !innings.closed,
    // A bowler never bowls two overs running, so the last over's bowler sits
    // the next one out.
    lastOverBowlerId:
      !innings.closed && balls > 0 && balls % 6 === 0 && deliveries.length
        ? deliveries[deliveries.length - 1].bowler_id ?? null
        : null,
  };
}

async function dismissalText(d) {
  const ids = [d.bowler_id, d.fielder_id].filter(Boolean);
  const named = ids.length
    ? await db
        .prepare(`SELECT id, name FROM players WHERE id IN (${ids.map(() => '?').join(',')})`)
        .all(...ids)
    : [];
  const nameMap = new Map(named.map((row) => [row.id, row.name]));
  const name = (id) => (id ? nameMap.get(id) || '' : '');
  const type = d.wicket_type || '';
  if (type === 'caught and bowled') return `c & b ${name(d.bowler_id)}`;
  if (type === 'caught') return `c ${name(d.fielder_id) || 'fielder'} b ${name(d.bowler_id)}`;
  if (type === 'bowled') return `b ${name(d.bowler_id)}`;
  if (type === 'lbw') return `lbw b ${name(d.bowler_id)}`;
  if (type === 'stumped') return `st ${name(d.fielder_id) || 'keeper'} b ${name(d.bowler_id)}`;
  if (type === 'run out') return d.fielder_id ? `run out (${name(d.fielder_id)})` : 'run out';
  if (type === 'hit wicket') return `hit wicket b ${name(d.bowler_id)}`;
  if (type === 'retired hurt') return 'retired hurt';
  if (type === 'obstructing the field') return 'obstructing the field';
  return type || 'out';
}

/* ------------------------------------------------------------------ */
/* Match state                                                         */
/* ------------------------------------------------------------------ */

export async function getInningsRows(matchId) {
  return db.prepare('SELECT * FROM innings WHERE match_id = ? ORDER BY innings_no').all(matchId);
}

export async function inningsTotals(inningsId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(runs + extra_runs), 0) AS runs,
              COALESCE(SUM(is_wicket), 0) AS wickets,
              COALESCE(SUM(CASE WHEN extra_type IS NULL OR extra_type IN ('b','lb') THEN 1 ELSE 0 END), 0) AS balls
       FROM deliveries WHERE innings_id = ?`
    )
    .get(inningsId);
}

export async function getMatchState(matchId) {
  const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return null;
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(match.season_id);
  const teamA = match.team_a_id ? await db.prepare('SELECT * FROM teams WHERE id = ?').get(match.team_a_id) : null;
  const teamB = match.team_b_id ? await db.prepare('SELECT * FROM teams WHERE id = ?').get(match.team_b_id) : null;
  const inningsRows = await getInningsRows(matchId);
  const summaries = [];
  for (const inn of inningsRows) {
    const t = await inningsTotals(inn.id);
    summaries.push({
      ...inn,
      ...t,
      overs: oversText(t.balls),
      battingTeam: await db.prepare('SELECT id, name, short_name, color FROM teams WHERE id = ?').get(inn.batting_team_id),
      bowlingTeam: await db.prepare('SELECT id, name, short_name, color FROM teams WHERE id = ?').get(inn.bowling_team_id),
    });
  }
  const currentRow = inningsRows.find((i) => !i.closed) || inningsRows[inningsRows.length - 1] || null;
  let current = null;
  if (currentRow) {
    const deliveries = await db.prepare('SELECT * FROM deliveries WHERE innings_id = ? ORDER BY id').all(currentRow.id);
    current = await computeInnings(currentRow, deliveries, match);
    const playerName = async (id) => (await db.prepare('SELECT id, name FROM players WHERE id = ?').get(id)) || null;
    const withPlayer = async (rows) => {
      const out = [];
      for (const row of rows) out.push({ ...row, player: await playerName(row.playerId) });
      return out;
    };
    current.batting = await withPlayer(current.batting);
    current.bowling = await withPlayer(current.bowling);
  }
  const xi = await db
    .prepare(
      `SELECT xi.*, p.name AS player_name, p.role, p.bowl_style, p.batting_style
       FROM match_xi xi JOIN players p ON p.id = xi.player_id
       WHERE xi.match_id = ? ORDER BY xi.team_id, xi.rowid`
    )
    .all(matchId);

  return {
    match,
    season,
    teamA,
    teamB,
    innings: summaries,
    current,
    xi,
    needsXi: xi.length === 0,
    canDeclare:
      (match.format === 'test' || match.format === 'custom') &&
      match.status === 'live' &&
      !!currentRow &&
      !currentRow.closed &&
      currentRow.innings_no < match.innings_limit,
  };
}

export async function getScorecard(matchId) {
  const state = await getMatchState(matchId);
  if (!state) return null;
  const cards = [];
  for (const inn of state.innings) {
    const deliveries = await db.prepare('SELECT * FROM deliveries WHERE innings_id = ? ORDER BY id').all(inn.id);
    const computed = await computeInnings(inn, deliveries, state.match);
    const nameOf = async (id) => (await db.prepare('SELECT name FROM players WHERE id = ?').get(id))?.name || 'Unknown';
    const batting = [];
    for (const b of computed.batting) batting.push({ ...b, name: await nameOf(b.playerId) });
    const bowling = [];
    for (const b of computed.bowling) {
      bowling.push({
        ...b,
        name: await nameOf(b.playerId),
        economy: b.balls ? (b.runs / (b.balls / 6)).toFixed(2) : '0.00',
      });
    }
    const fallOfWickets = [];
    for (const f of computed.fallOfWickets) fallOfWickets.push({ ...f, name: await nameOf(f.playerId) });
    // Every delivery, grouped by over, so the scorecard can show what each ball cost.
    const overMap = new Map();
    for (const d of deliveries) {
      if (!overMap.has(d.over_no)) overMap.set(d.over_no, { overNo: d.over_no, bowlerId: d.bowler_id, tokens: [], runs: 0 });
      const entry = overMap.get(d.over_no);
      entry.tokens.push(ballLabel(d));
      entry.runs += (d.runs || 0) + (d.extra_runs || 0);
    }
    const overGroups = [];
    for (const entry of overMap.values()) {
      overGroups.push({ ...entry, bowlerName: entry.bowlerId ? await nameOf(entry.bowlerId) : '' });
    }
    cards.push({ ...computed, batting, bowling, fallOfWickets, overGroups });
  }
  return { ...state, cards };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export async function recomputeInningsState(inningsId) {
  const innings = await db.prepare('SELECT * FROM innings WHERE id = ?').get(inningsId);
  if (!innings) return null;
  const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(innings.match_id);
  const deliveries = await db.prepare('SELECT * FROM deliveries WHERE innings_id = ? ORDER BY id').all(inningsId);
  const computed = await computeInnings(innings, deliveries, match);
  // The over is done: the next over needs a new bowler named. A ball undone
  // inside an unfinished over keeps the bowler who was bowling it.
  const overComplete = !computed.closed && computed.balls > 0 && computed.balls % 6 === 0;
  if (overComplete) {
    const lastBowler = deliveries.length ? deliveries[deliveries.length - 1].bowler_id ?? null : null;
    // The man who bowled the over just finished cannot start the next one, so
    // the slot stays empty until someone else is named. A bowler named after
    // the over ended is kept — this runs on every ball, not just the sixth.
    const chosen = innings.current_bowler_id ? Number(innings.current_bowler_id) : null;
    if (chosen && chosen !== Number(lastBowler)) {
      computed.bowlerId = chosen;
      computed.needsNewBowler = false;
    } else {
      computed.bowlerId = null;
      computed.needsNewBowler = true;
    }
  } else if (computed.bowlerId == null && deliveries.length) {
    computed.bowlerId = deliveries[deliveries.length - 1].bowler_id ?? null;
    computed.needsNewBowler = false;
  }
  await db.prepare(
    'UPDATE innings SET current_striker_id = ?, current_non_striker_id = ?, current_bowler_id = ? WHERE id = ?'
  ).run(computed.strikerId, computed.nonStrikerId, computed.bowlerId, inningsId);
  return computed;
}

export async function addDelivery(matchId, inningsId, input) {
  const innings = await db.prepare('SELECT * FROM innings WHERE id = ? AND match_id = ?').get(inningsId, matchId);
  if (!innings) throw new Error('Innings not found');
  if (innings.closed) throw new Error('This innings is already closed');
  const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match || match.status !== 'live') throw new Error('Match is not live');

  const legalBalls = (await inningsTotals(inningsId)).balls;
  if (match.overs && legalBalls >= match.overs * 6) throw new Error('Over limit reached for this innings');

  const strikerId = Number(input.strikerId);
  const nonStrikerId = Number(input.nonStrikerId);
  const bowlerId = Number(input.bowlerId);
  const xiIds = (await db.prepare('SELECT player_id FROM match_xi WHERE match_id = ?').all(matchId)).map(
    (r) => r.player_id
  );
  if (![strikerId, nonStrikerId, bowlerId].every((id) => xiIds.includes(id))) {
    throw new Error('Striker, non-striker and bowler must be part of the playing XI');
  }
  const keeper = await db
    .prepare('SELECT 1 FROM match_xi WHERE match_id = ? AND player_id = ? AND is_wk = 1')
    .get(matchId, bowlerId);
  if (keeper) throw new Error('The wicketkeeper cannot bowl');
  if (strikerId === nonStrikerId) throw new Error('Striker and non-striker must be different players');
  if (bowlerId === strikerId || bowlerId === nonStrikerId) throw new Error('A bowler cannot bowl to themselves');

  const extraType = input.extraType || null;
  if (![null, 'wd', 'nb', 'b', 'lb'].includes(extraType)) throw new Error('Invalid extra type');
  const runs = Number(input.runs ?? 0);
  if (!Number.isFinite(runs) || runs < 0 || runs > 6) throw new Error('Runs off the bat must be between 0 and 6');
  let extraRuns = Number(input.extraRuns ?? 0);
  if (!Number.isFinite(extraRuns) || extraRuns < 0) throw new Error('Invalid extra runs');
  if (extraType) extraRuns = Math.max(1, extraRuns);
  else extraRuns = 0;

  const isWicket = !!input.wicket;
  let wicketType = null;
  let dismissedId = null;
  let fielderId = null;
  if (isWicket) {
    wicketType = WICKET_TYPES.includes(input.wicket.type) ? input.wicket.type : 'bowled';
    dismissedId = Number(input.wicket.dismissedId || strikerId);
    if (!xiIds.includes(dismissedId)) throw new Error('Dismissed batter must be in the XI');
    if (dismissedId !== strikerId && dismissedId !== nonStrikerId) {
      throw new Error('Dismissed batter must be one of the two batters at the crease');
    }
    fielderId = input.wicket.fielderId ? Number(input.wicket.fielderId) : null;
    if (fielderId && !xiIds.includes(fielderId)) throw new Error('Fielder must be in the XI');
  }

  // IPL extras law: a no-ball (and the free hit that follows it) can only cost
  // a run out or obstructing the field; a wide can only cost a stumping or a
  // run out. Everything else is rejected so the scorecard cannot go illegal.
  const onFreeHit = freeHitPending(
    await db.prepare('SELECT extra_type FROM deliveries WHERE innings_id = ? ORDER BY id').all(inningsId)
  );
  if (isWicket) {
    if (onFreeHit && !isFreeHitDismissal(wicketType)) {
      throw new Error('That delivery is a free hit — the batter can only be run out');
    }
    if (extraType === 'nb' && !isFreeHitDismissal(wicketType)) {
      throw new Error('A no-ball cannot take a wicket — only a run out or obstruction is possible');
    }
    if (extraType === 'wd' && !['stumped', 'run out', 'obstructing the field'].includes(wicketType)) {
      throw new Error('A wide can only take a stumping or a run out');
    }
  }

  const { balls } = await inningsTotals(inningsId);
  const overNo = Math.floor(balls / 6) + 1;
  const ballNo = (balls % 6) + 1;

  await db.prepare(
    `INSERT INTO deliveries
     (match_id, innings_id, over_no, ball_no, batter_id, non_striker_id, bowler_id,
      runs, extra_type, extra_runs, is_wicket, wicket_type, dismissed_id, fielder_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    matchId,
    inningsId,
    overNo,
    ballNo,
    strikerId,
    nonStrikerId,
    bowlerId,
    runs,
    extraType,
    extraRuns,
    isWicket ? 1 : 0,
    wicketType,
    isWicket ? dismissedId : null,
    fielderId,
    now()
  );

  const computed = await recomputeInningsState(inningsId);
  await evaluateInnings(matchId, inningsId, computed);
  return getMatchState(matchId);
}

export async function evaluateInnings(matchId, inningsId, computed = null) {
  const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  const innings = await db.prepare('SELECT * FROM innings WHERE id = ?').get(inningsId);
  if (!match || !innings || innings.closed) return;
  const c =
    computed ||
    (await computeInnings(
      innings,
      await db.prepare('SELECT * FROM deliveries WHERE innings_id = ? ORDER BY id').all(inningsId),
      match
    ));
  const allOut = c.wickets >= 10;
  const oversDone = match.overs != null && c.balls >= match.overs * 6;
  const chased = c.target != null && c.runs >= c.target;
  if (allOut || oversDone || chased) await closeInnings(matchId, inningsId, { declared: false });
}

export async function closeInnings(matchId, inningsId, { declared = false } = {}) {
  const innings = await db.prepare('SELECT * FROM innings WHERE id = ?').get(inningsId);
  if (!innings || innings.closed) return getMatchState(matchId);
  await db.prepare('UPDATE innings SET closed = 1, declared = ? WHERE id = ?').run(declared ? 1 : 0, inningsId);
  await advanceMatch(matchId);
  return getMatchState(matchId);
}

async function aggregateForTeam(matchId, teamId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(d.runs + d.extra_runs), 0) AS runs
       FROM deliveries d JOIN innings i ON i.id = d.innings_id
       WHERE d.match_id = ? AND i.batting_team_id = ?`
    )
    .get(matchId, teamId);
}

export async function targetForInnings(matchId, inningsNo, battingTeamId, bowlingTeamId, inningsLimit) {
  if (inningsLimit === 2) {
    if (inningsNo !== 2) return null;
    const first = (await getInningsRows(matchId)).find((r) => r.innings_no === 1);
    return first ? (await inningsTotals(first.id)).runs + 1 : null;
  }
  if (inningsNo !== inningsLimit) return null;
  const mine = (await aggregateForTeam(matchId, battingTeamId)).runs;
  const theirs = (await aggregateForTeam(matchId, bowlingTeamId)).runs;
  return theirs >= mine ? theirs - mine + 1 : null;
}

export async function advanceMatch(matchId) {
  const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return;
  const rows = await getInningsRows(matchId);
  const last = rows[rows.length - 1];
  if (!last) return;
  const totals = await inningsTotals(last.id);
  const chaseComplete = last.target != null && totals.runs >= last.target;

  if (last.innings_no < match.innings_limit && !chaseComplete) {
    const nextNo = last.innings_no + 1;
    const target = await targetForInnings(
      matchId,
      nextNo,
      last.bowling_team_id,
      last.batting_team_id,
      match.innings_limit
    );
    await db
      .prepare(
        `INSERT INTO innings (match_id, innings_no, batting_team_id, bowling_team_id, target, closed, created_at)
         VALUES (?,?,?,?,?,0,?)`
      )
      .run(matchId, nextNo, last.bowling_team_id, last.batting_team_id, target, now());
    return;
  }
  await finalizeMatch(matchId);
}

export async function finalizeMatch(matchId) {
  const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match || match.status === 'completed') return;
  const rows = await getInningsRows(matchId);
  if (!rows.length) return;
  const teamA = match.team_a_id;
  const teamB = match.team_b_id;
  const totals = [];
  for (const r of rows) totals.push({ ...r, ...(await inningsTotals(r.id)) });
  const aggA = totals.filter((i) => i.batting_team_id === teamA).reduce((s, i) => s + i.runs, 0);
  const aggB = totals.filter((i) => i.batting_team_id === teamB).reduce((s, i) => s + i.runs, 0);
  const teamRows = await db.prepare('SELECT id, name FROM teams WHERE id IN (?,?)').all(teamA, teamB);
  const teamName = (id) => teamRows.find((row) => row.id === id)?.name || 'Team';
  const last = totals[totals.length - 1];

  let winnerId = null;
  let resultType = null;
  let resultText = null;

  if (match.innings_limit === 2) {
    if (totals.length < 2) {
      resultType = 'no_result';
      resultText = 'No result — only one innings was played';
    } else {
      const [first, second] = totals;
      const chasingTeam = second.batting_team_id;
      if (second.target != null && second.runs >= second.target) {
        winnerId = chasingTeam;
        resultType = 'win';
        const wktsLeft = 10 - second.wickets;
        resultText = `${teamName(chasingTeam)} won by ${wktsLeft} wicket${wktsLeft === 1 ? '' : 's'}`;
      } else if (second.runs === first.runs) {
        resultType = 'tie';
        resultText = 'Match tied';
      } else if (second.runs < first.runs) {
        winnerId = first.batting_team_id;
        resultType = 'win';
        const margin = first.runs - second.runs;
        resultText = `${teamName(winnerId)} won by ${margin} run${margin === 1 ? '' : 's'}`;
      } else {
        // second innings closed early by admin
        winnerId = chasingTeam;
        resultType = 'win';
        resultText = `${teamName(chasingTeam)} won`;
      }
    }
  } else {
    if (totals.length < match.innings_limit) {
      resultType = aggA === aggB ? 'draw' : 'win';
      winnerId = aggA === aggB ? null : aggA > aggB ? teamA : teamB;
      resultText =
        aggA === aggB
          ? 'Match drawn'
          : `${teamName(winnerId)} won on aggregate (${Math.max(aggA, aggB)} v ${Math.min(aggA, aggB)})`;
    } else if (last.target != null && last.runs >= last.target) {
      winnerId = last.batting_team_id;
      resultType = 'win';
      const wktsLeft = 10 - last.wickets;
      resultText = `${teamName(winnerId)} won by ${wktsLeft} wicket${wktsLeft === 1 ? '' : 's'}`;
    } else if (aggA === aggB) {
      resultType = 'tie';
      resultText = 'Match tied';
    } else {
      winnerId = aggA > aggB ? teamA : teamB;
      resultType = 'win';
      const margin = Math.abs(aggA - aggB);
      resultText = `${teamName(winnerId)} won by ${margin} run${margin === 1 ? '' : 's'}`;
    }
  }

  const rules = await leagueRules();
  const level = ['tie', 'draw', 'no_result'].includes(resultType);

  /* A knockout cannot end level: unless the league asks for a replay, the side
     higher in the league table goes through so the bracket never stalls. */
  if (match.stage === 'playoff' && !winnerId && level && rules.playoffTieRule === 'table') {
    const table = await pointsTable(match.season_id);
    const seed = (id) => table.find((r) => r.teamId === id)?.position ?? Number.MAX_SAFE_INTEGER;
    const [seedA, seedB] = [seed(teamA), seed(teamB)];
    if (seedA !== seedB) {
      winnerId = seedA < seedB ? teamA : teamB;
      resultText = `${resultText} — ${teamName(winnerId)} advance on league position`;
    }
  }

  let pointsA = 0;
  let pointsB = 0;
  if (match.stage === 'league') {
    if (resultType === 'win') {
      pointsA = winnerId === teamA ? rules.pointsWin : 0;
      pointsB = winnerId === teamB ? rules.pointsWin : 0;
    } else if (level) {
      pointsA = rules.pointsTie;
      pointsB = rules.pointsTie;
    }
  }

  await db
    .prepare(
      `UPDATE matches SET status = 'completed', winner_team_id = ?, result_type = ?, result_text = ?,
       team_a_points = ?, team_b_points = ?, completed_at = ? WHERE id = ?`
    )
    .run(winnerId, resultType, resultText, pointsA, pointsB, now(), matchId);

  const finished = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (finished.stage === 'playoff') await propagatePlayoff(finished);
  void teamB;
}

/* League rules the admin sets in Settings. Everything that spends or awards
   points reads them here so the scorebook, the table and the record book agree. */
export async function leagueRules() {
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const tieRule = (await getSetting('playoff_tie_rule', 'table')) === 'replay' ? 'replay' : 'table';
  return {
    pointsWin: num(await getSetting('points_win', '2'), 2),
    pointsTie: num(await getSetting('points_tie', '1'), 1),
    playoffTieRule: tieRule,
  };
}

/* The league-wide settings the admin edits in Settings, in one shape for the
   API, the season creator and anything else that needs the defaults. */
export async function leagueSettings() {
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const format = await getSetting('default_format', 't20');
  const tieRule = await getSetting('playoff_tie_rule', 'table');
  const playoffTeams = Number(await getSetting('default_playoff_teams', '4'));
  return {
    leagueName: (await getSetting('league_name', 'The Cricket League')) || 'The Cricket League',
    pointsWin: num(await getSetting('points_win', '2'), 2),
    pointsTie: num(await getSetting('points_tie', '1'), 1),
    playoffTieRule: tieRule === 'replay' ? 'replay' : 'table',
    defaultFormat: ['t20', 'odi', 'test', 'custom'].includes(format) ? format : 't20',
    defaultOvers: num(await getSetting('default_overs', '20'), 20),
    defaultPlayoffTeams: [2, 4, 5].includes(playoffTeams) ? playoffTeams : 4,
  };
}

/* ------------------------------------------------------------------ */
/* Playoffs                                                            */
/* ------------------------------------------------------------------ */

export function playoffTemplate(size) {
  if (size === 2) {
    return [{ key: 'P1', name: 'Final', seedA: '1', seedB: '2', winnerTo: null, loserTo: null }];
  }
  if (size === 4) {
    return [
      { key: 'P1', name: 'Qualifier 1', seedA: '1', seedB: '2', winnerTo: 'P4', loserTo: 'P3' },
      { key: 'P2', name: 'Eliminator', seedA: '3', seedB: '4', winnerTo: 'P3', loserTo: null },
      { key: 'P3', name: 'Qualifier 2', seedA: 'L:P1', seedB: 'W:P2', winnerTo: 'P4', loserTo: null },
      { key: 'P4', name: 'Final', seedA: 'W:P1', seedB: 'W:P3', winnerTo: null, loserTo: null },
    ];
  }
  if (size === 5) {
    return [
      { key: 'P1', name: 'Eliminator 1', seedA: '4', seedB: '5', winnerTo: 'P2', loserTo: null },
      { key: 'P2', name: 'Eliminator 2', seedA: '3', seedB: 'W:P1', winnerTo: 'P4', loserTo: null },
      { key: 'P3', name: 'Qualifier 1', seedA: '1', seedB: '2', winnerTo: 'P5', loserTo: 'P4' },
      { key: 'P4', name: 'Qualifier 2', seedA: 'L:P3', seedB: 'W:P2', winnerTo: 'P5', loserTo: null },
      { key: 'P5', name: 'Final', seedA: 'W:P3', seedB: 'W:P4', winnerTo: null, loserTo: null },
    ];
  }
  throw new Error('Playoff size must be 2, 4 or 5');
}

export async function seedPlayoffs(seasonId, orderedTeamIds) {
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) throw new Error('Season not found');
  const template = playoffTemplate(orderedTeamIds.length);
  const existing = (
    await db.prepare("SELECT COUNT(*) AS n FROM matches WHERE season_id = ? AND stage = 'playoff'").get(seasonId)
  ).n;
  if (existing > 0) throw new Error('Playoffs already created for this season');

  const insert = db.prepare(
    `INSERT INTO matches (season_id, stage, match_no, stage_name, team_a_id, team_b_id, status, format, overs,
      innings_limit, bracket_key, seed_a, seed_b, winner_to, loser_to, created_at)
     VALUES (?, 'playoff', ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const resolveSeed = (token) => {
    if (!token || token.startsWith('W:') || token.startsWith('L:')) return null;
    return orderedTeamIds[Number(token) - 1] ?? null;
  };
  for (const [i, t] of template.entries()) {
    await insert.run(
      seasonId,
      i + 1,
      t.name,
      resolveSeed(t.seedA),
      resolveSeed(t.seedB),
      season.format,
      season.overs_per_innings,
      season.innings_limit,
      t.key,
      t.seedA,
      t.seedB,
      t.winnerTo,
      t.loserTo,
      now()
    );
  }
  await db
    .prepare("UPDATE seasons SET status = 'playoffs', playoff_teams = ? WHERE id = ?")
    .run(orderedTeamIds.length, seasonId);
  return db.prepare("SELECT * FROM matches WHERE season_id = ? AND stage = 'playoff' ORDER BY match_no").all(seasonId);
}

export async function propagatePlayoff(match) {
  const winner = match.winner_team_id;
  if (!winner) return;
  const loser = winner === match.team_a_id ? match.team_b_id : match.team_a_id;
  const apply = async (targetKey, teamId) => {
    if (!targetKey || !teamId) return;
    const target = await db
      .prepare("SELECT * FROM matches WHERE season_id = ? AND stage = 'playoff' AND bracket_key = ?")
      .get(match.season_id, targetKey);
    if (!target) return;
    const token = `${match.winner_to === targetKey ? 'W' : 'L'}:${match.bracket_key}`;
    if (target.seed_a === token)
      await db.prepare('UPDATE matches SET team_a_id = ? WHERE id = ?').run(teamId, target.id);
    else if (target.seed_b === token)
      await db.prepare('UPDATE matches SET team_b_id = ? WHERE id = ?').run(teamId, target.id);
  };
  await apply(match.winner_to, winner);
  await apply(match.loser_to, loser);
  void loser;

  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(match.season_id);
  if (!season) return;
  const remaining = (
    await db
      .prepare(
        "SELECT COUNT(*) AS n FROM matches WHERE season_id = ? AND stage = 'playoff' AND status NOT IN ('completed','abandoned')"
      )
      .get(match.season_id)
  ).n;
  if (remaining === 0) {
    const keys = playoffTemplate(season.playoff_teams || 4);
    const finalKey = keys[keys.length - 1].key;
    const final = await db
      .prepare("SELECT * FROM matches WHERE season_id = ? AND stage = 'playoff' AND bracket_key = ?")
      .get(match.season_id, finalKey);
    if (final && final.winner_team_id) {
      await db
        .prepare("UPDATE seasons SET status = 'completed', winner_team_id = ?, runner_up_team_id = ? WHERE id = ?")
        .run(
          final.winner_team_id,
          final.winner_team_id === final.team_a_id ? final.team_b_id : final.team_a_id,
          match.season_id
        );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Points table                                                        */
/* ------------------------------------------------------------------ */

export async function pointsTable(seasonId) {
  const season = await db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return [];
  const teams = await db
    .prepare(
      `SELECT t.* FROM season_teams st JOIN teams t ON t.id = st.team_id
       WHERE st.season_id = ? ORDER BY t.name`
    )
    .all(seasonId);
  const matches = await db
    .prepare("SELECT * FROM matches WHERE season_id = ? AND stage = 'league' AND status IN ('completed','abandoned')")
    .all(seasonId);

  const tiePoints = (await leagueRules()).pointsTie;
  const table = new Map();
  for (const t of teams) {
    table.set(t.id, {
      teamId: t.id,
      name: t.name,
      shortName: t.short_name,
      color: t.color,
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
      nrr: 0,
      form: [],
    });
  }

  for (const m of matches) {
    if (!m.team_a_id || !m.team_b_id) continue;
    const a = table.get(m.team_a_id);
    const b = table.get(m.team_b_id);
    if (!a || !b) continue;
    a.played += 1;
    b.played += 1;

    const innings = [];
    for (const i of await getInningsRows(m.id)) innings.push({ ...i, ...(await inningsTotals(i.id)) });
    for (const inn of innings) {
      const bat = table.get(inn.batting_team_id);
      const bowl = table.get(inn.bowling_team_id);
      if (!bat || !bowl) continue;
      const overs = inn.balls === 0 ? 0 : m.overs && inn.wickets >= 10 ? m.overs : inn.balls / 6;
      bat.runsFor += inn.runs;
      bat.ballsFor += Math.round(overs * 6);
      bowl.runsAgainst += inn.runs;
      bowl.ballsAgainst += Math.round(overs * 6);
    }

    if (m.status === 'abandoned' || m.result_type === 'no_result') {
      a.noResult += 1;
      b.noResult += 1;
      a.points += tiePoints;
      b.points += tiePoints;
      a.form.push('N');
      b.form.push('N');
    } else if (m.result_type === 'tie' || m.result_type === 'draw') {
      a.tied += 1;
      b.tied += 1;
      a.points += tiePoints;
      b.points += tiePoints;
      a.form.push('T');
      b.form.push('T');
    } else if (m.winner_team_id) {
      const winner = m.winner_team_id === m.team_a_id ? a : b;
      const loser = m.winner_team_id === m.team_a_id ? b : a;
      winner.won += 1;
      winner.points += m.winner_team_id === m.team_a_id ? m.team_a_points : m.team_b_points;
      loser.lost += 1;
      loser.points += m.winner_team_id === m.team_a_id ? m.team_b_points : m.team_a_points;
      winner.form.push('W');
      loser.form.push('L');
    }
  }

  const rows = [...table.values()].map((r) => {
    const nrr =
      (r.ballsFor ? r.runsFor / (r.ballsFor / 6) : 0) - (r.ballsAgainst ? r.runsAgainst / (r.ballsAgainst / 6) : 0);
    return {
      ...r,
      nrr: Number.isFinite(nrr) ? Number(nrr.toFixed(3)) : 0,
      oversFor: oversText(r.ballsFor),
      oversAgainst: oversText(r.ballsAgainst),
      form: r.form.slice(-5),
    };
  });
  rows.sort((x, y) => y.points - x.points || y.nrr - x.nrr || y.won - x.won || x.name.localeCompare(y.name));
  rows.forEach((r, i) => {
    r.position = i + 1;
    r.qualified = season.playoff_teams ? i < season.playoff_teams : false;
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

async function scopeDeliveries({ seasonId = null, teamId = null } = {}) {
  const params = [];
  let sql = `SELECT d.*, i.batting_team_id, i.bowling_team_id, m.season_id
             FROM deliveries d
             JOIN innings i ON i.id = d.innings_id
             JOIN matches m ON m.id = d.match_id
             WHERE m.status = 'completed'`;
  if (seasonId) {
    sql += ' AND m.season_id = ?';
    params.push(seasonId);
  }
  if (teamId) {
    sql += ' AND (i.batting_team_id = ? OR i.bowling_team_id = ?)';
    params.push(teamId, teamId);
  }
  return db.prepare(sql).all(...params);
}

const emptyBat = (playerId) => ({
  playerId,
  innings: 0,
  runs: 0,
  balls: 0,
  fours: 0,
  sixes: 0,
  outs: 0,
  highScore: 0,
  notOuts: 0,
  fifties: 0,
  hundreds: 0,
  ducks: 0,
});

const emptyBowl = (playerId) => ({
  playerId,
  innings: 0,
  balls: 0,
  runs: 0,
  wickets: 0,
  bestWickets: 0,
  bestRuns: 0,
  fiveWicketHauls: 0,
  catches: 0,
  runOuts: 0,
});

export async function aggregateStats({ seasonId = null, teamId = null } = {}) {
  const deliveries = await scopeDeliveries({ seasonId, teamId });
  const bat = new Map();
  const bowl = new Map();
  const batInnings = new Map();
  const bowlInnings = new Map();

  for (const d of deliveries) {
    if (!bat.has(d.batter_id)) bat.set(d.batter_id, emptyBat(d.batter_id));
    const b = bat.get(d.batter_id);
    const innKey = `${d.batter_id}:${d.innings_id}`;
    if (!batInnings.has(innKey)) batInnings.set(innKey, { runs: 0, balls: 0, out: false, fours: 0, sixes: 0 });
    const bi = batInnings.get(innKey);
    b.runs += d.runs || 0;
    if (d.extra_type !== 'wd') b.balls += 1;
    if (d.runs === 4) b.fours += 1;
    if (d.runs === 6) b.sixes += 1;
    bi.runs += d.runs || 0;
    if (d.extra_type !== 'wd') bi.balls += 1;
    if (d.runs === 4) bi.fours += 1;
    if (d.runs === 6) bi.sixes += 1;
    if (d.is_wicket && d.dismissed_id === d.batter_id) {
      b.outs += 1;
      bi.out = true;
    }

    if (!bowl.has(d.bowler_id)) bowl.set(d.bowler_id, emptyBowl(d.bowler_id));
    const bw = bowl.get(d.bowler_id);
    const bowlKey = `${d.bowler_id}:${d.innings_id}`;
    if (!bowlInnings.has(bowlKey)) bowlInnings.set(bowlKey, { balls: 0, runs: 0, wickets: 0 });
    const bo = bowlInnings.get(bowlKey);
    const legal = isLegalBall(d.extra_type);
    const conceded = (d.runs || 0) + (d.extra_type === 'wd' || d.extra_type === 'nb' ? d.extra_runs || 0 : 0);
    bw.balls += legal ? 1 : 0;
    bw.runs += conceded;
    bo.balls += legal ? 1 : 0;
    bo.runs += conceded;
    if (d.is_wicket && BOWLER_CREDIT.has(d.wicket_type)) {
      bw.wickets += 1;
      bo.wickets += 1;
    }
    if (d.is_wicket && d.fielder_id && ['caught', 'stumped', 'caught and bowled'].includes(d.wicket_type)) {
      if (!bowl.has(d.fielder_id)) bowl.set(d.fielder_id, emptyBowl(d.fielder_id));
      bowl.get(d.fielder_id).catches += 1;
    }
    if (d.is_wicket && d.wicket_type === 'run out' && d.fielder_id) {
      if (!bowl.has(d.fielder_id)) bowl.set(d.fielder_id, emptyBowl(d.fielder_id));
      bowl.get(d.fielder_id).runOuts += 1;
    }
  }

  const inningsCount = new Map();
  for (const key of batInnings.keys()) {
    const pid = Number(key.split(':')[0]);
    inningsCount.set(pid, (inningsCount.get(pid) || 0) + 1);
  }
  for (const [key, bi] of batInnings) {
    const pid = Number(key.split(':')[0]);
    const b = bat.get(pid);
    if (!b) continue;
    b.innings = inningsCount.get(pid) || 0;
    b.highScore = Math.max(b.highScore, bi.runs);
    if (bi.runs >= 100) b.hundreds += 1;
    else if (bi.runs >= 50) b.fifties += 1;
    if (bi.runs === 0 && bi.out) b.ducks += 1;
    if (!bi.out) b.notOuts += 1;
  }

  const bowlInningsCount = new Map();
  for (const [key, bo] of bowlInnings) {
    const pid = Number(key.split(':')[0]);
    bowlInningsCount.set(pid, (bowlInningsCount.get(pid) || 0) + 1);
    const bw = bowl.get(pid);
    if (!bw) continue;
    if (bo.wickets > bw.bestWickets || (bo.wickets === bw.bestWickets && bo.wickets > 0 && bo.runs < bw.bestRuns)) {
      bw.bestWickets = bo.wickets;
      bw.bestRuns = bo.runs;
    }
    if (bo.wickets >= 5) bw.fiveWicketHauls += 1;
  }
  for (const [pid, bw] of bowl) {
    bw.innings = bowlInningsCount.get(pid) || 0;
    bw.average = bw.wickets ? Number((bw.runs / bw.wickets).toFixed(2)) : null;
    bw.economy = bw.balls ? Number((bw.runs / (bw.balls / 6)).toFixed(2)) : null;
    bw.strikeRate = bw.wickets ? Number((bw.balls / bw.wickets).toFixed(1)) : null;
    bw.best = bw.bestWickets ? `${bw.bestWickets}/${bw.bestRuns}` : '—';
  }

  for (const b of bat.values()) {
    b.strikeRate = b.balls ? Number(((b.runs / b.balls) * 100).toFixed(2)) : 0;
    b.average = b.outs ? Number((b.runs / b.outs).toFixed(2)) : b.runs ? b.runs : 0;
  }

  return { batting: [...bat.values()], bowling: [...bowl.values()] };
}

export async function leaderboards({ seasonId = null, teamId = null, limit = 10 } = {}) {
  const { batting, bowling } = await aggregateStats({ seasonId, teamId });
  const players = new Map(
    (await db.prepare('SELECT id, name, role FROM players').all()).map((p) => [p.id, p])
  );
  const battingRows = batting
    .map((b) => ({ ...b, name: players.get(b.playerId)?.name || 'Unknown' }))
    .sort((a, b) => b.runs - a.runs || b.highScore - a.highScore || a.balls - b.balls)
    .slice(0, limit);
  const bowlingRows = bowling
    .map((b) => ({ ...b, name: players.get(b.playerId)?.name || 'Unknown' }))
    .sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)
    .slice(0, limit);
  return { batting: battingRows, bowling: bowlingRows };
}

export async function seasonAwards(seasonId) {
  const { batting, bowling } = await aggregateStats({ seasonId });
  const nameOf = async (id) => (await db.prepare('SELECT name FROM players WHERE id = ?').get(id))?.name || 'Unknown';
  const topBat = [...batting].sort((a, b) => b.runs - a.runs || b.highScore - a.highScore)[0] || null;
  const topBowl = [...bowling].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0] || null;
  return {
    mostRuns: topBat ? { ...topBat, name: await nameOf(topBat.playerId) } : null,
    mostWickets: topBowl ? { ...topBowl, name: await nameOf(topBowl.playerId) } : null,
  };
}

export async function teamAnalytics(teamId, seasonId = null) {
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return null;
  // seasonId === 'all' returns career totals across every season this team played.
  const career = seasonId === 'all';
  const resolvedSeasonId = career
    ? null
    : seasonId ||
      (
        await db
          .prepare(
            `SELECT s.id FROM season_teams st JOIN seasons s ON s.id = st.season_id
             WHERE st.team_id = ? ORDER BY s.id DESC LIMIT 1`
          )
          .get(teamId)
      )?.id ||
      null;
  const season = career
    ? { id: 'all', name: 'All seasons', formatLabel: 'Career', status: null }
    : resolvedSeasonId
      ? await db.prepare('SELECT * FROM seasons WHERE id = ?').get(resolvedSeasonId)
      : null;
  const params = [teamId, teamId];
  let sql = `SELECT m.* FROM matches m WHERE (m.team_a_id = ? OR m.team_b_id = ?) AND m.status = 'completed'`;
  if (resolvedSeasonId) {
    sql += ' AND m.season_id = ?';
    params.push(resolvedSeasonId);
  }
  sql += ' ORDER BY m.scheduled_at DESC, m.id DESC';
  const matches = await db.prepare(sql).all(...params);

  let won = 0;
  let lost = 0;
  let tied = 0;
  for (const m of matches) {
    if (!m.winner_team_id) tied += 1;
    else if (m.winner_team_id === teamId) won += 1;
    else lost += 1;
  }

  const rawSquad = await db
    .prepare(
      `SELECT sp.*, p.name, p.role, p.bowl_style, p.batting_style
       FROM season_players sp JOIN players p ON p.id = sp.player_id
       WHERE sp.team_id = ? ${resolvedSeasonId ? 'AND sp.season_id = ?' : ''}
       ORDER BY p.name`
    )
    .all(...(resolvedSeasonId ? [teamId, resolvedSeasonId] : [teamId]));
  // A career view spans seasons, so keep each player once (latest assignment wins).
  const squadRows = career
    ? [...new Map(rawSquad.map((row) => [row.player_id, row])).values()]
    : rawSquad;

  const stats = await leaderboards({ seasonId: resolvedSeasonId, teamId, limit: 1000 });
  const batMap = new Map(stats.batting.map((r) => [r.playerId, r]));
  const bowlMap = new Map(stats.bowling.map((r) => [r.playerId, r]));

  const players = squadRows.map((p) => {
    const batting = batMap.get(p.player_id) || emptyBat(p.player_id);
    const bowling = bowlMap.get(p.player_id) || emptyBowl(p.player_id);
    const impact =
      (batting.runs || 0) + (bowling.wickets || 0) * 20 + (bowling.catches || 0) * 8 + (bowling.runOuts || 0) * 6;
    return { ...p, id: p.player_id, batting, bowling, impact };
  });
  players.sort((a, b) => b.impact - a.impact);

  const totals = players.reduce(
    (acc, p) => {
      acc.runs += p.batting.runs || 0;
      acc.wickets += p.bowling.wickets || 0;
      acc.catches += p.bowling.catches || 0;
      return acc;
    },
    { runs: 0, wickets: 0, catches: 0 }
  );

  const titles = (await db.prepare('SELECT COUNT(*) AS n FROM seasons WHERE winner_team_id = ?').get(teamId)).n;

  return {
    team,
    season,
    record: { played: matches.length, won, lost, tied, titles },
    players,
    totals,
    topScorer: players.slice().sort((a, b) => (b.batting.runs || 0) - (a.batting.runs || 0))[0] || null,
    topWicketTaker: players.slice().sort((a, b) => (b.bowling.wickets || 0) - (a.bowling.wickets || 0))[0] || null,
    matches,
  };
}

export async function playerCareer(playerId) {
  const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return null;
  const assignments = await db
    .prepare(
      `SELECT sp.*, s.name AS season_name, s.format, s.status, s.id AS season_id,
              t.name AS team_name, t.short_name AS team_short, t.color AS team_color
       FROM season_players sp
       JOIN seasons s ON s.id = sp.season_id
       JOIN teams t ON t.id = sp.team_id
       WHERE sp.player_id = ?
       ORDER BY s.created_at DESC, s.id DESC`
    )
    .all(playerId);

  const careerBat = emptyBat(playerId);
  const careerBowl = emptyBowl(playerId);
  const perSeason = [];
  for (const a of assignments) {
    const { batting, bowling } = await aggregateStats({ seasonId: a.season_id });
    const b = batting.find((r) => r.playerId === playerId);
    const w = bowling.find((r) => r.playerId === playerId);
    perSeason.push({
      seasonId: a.season_id,
      seasonName: a.season_name,
      format: a.format,
      status: a.status,
      teamId: a.team_id,
      teamName: a.team_name,
      teamShort: a.team_short,
      teamColor: a.team_color,
      isCaptain: a.is_captain,
      isWicketkeeper: a.is_wicketkeeper,
      batting: b || emptyBat(playerId),
      bowling: w || emptyBowl(playerId),
    });
    if (b) {
      for (const key of ['runs', 'balls', 'fours', 'sixes', 'outs', 'fifties', 'hundreds', 'ducks', 'notOuts']) {
        careerBat[key] += b[key] || 0;
      }
      careerBat.innings += b.innings;
      careerBat.highScore = Math.max(careerBat.highScore, b.highScore);
    }
    if (w) {
      for (const key of ['balls', 'runs', 'wickets', 'catches', 'runOuts', 'fiveWicketHauls']) {
        careerBowl[key] += w[key] || 0;
      }
      if (w.bestWickets > careerBowl.bestWickets || (w.bestWickets === careerBowl.bestWickets && w.bestRuns < careerBowl.bestRuns)) {
        careerBowl.bestWickets = w.bestWickets;
        careerBowl.bestRuns = w.bestRuns;
      }
      careerBowl.innings += w.innings;
    }
  }
  careerBat.strikeRate = careerBat.balls ? Number(((careerBat.runs / careerBat.balls) * 100).toFixed(2)) : 0;
  careerBat.average = careerBat.outs ? Number((careerBat.runs / careerBat.outs).toFixed(2)) : careerBat.runs;
  careerBowl.economy = careerBowl.balls ? Number((careerBowl.runs / (careerBowl.balls / 6)).toFixed(2)) : null;
  careerBowl.average = careerBowl.wickets ? Number((careerBowl.runs / careerBowl.wickets).toFixed(2)) : null;
  careerBowl.best = careerBowl.bestWickets ? `${careerBowl.bestWickets}/${careerBowl.bestRuns}` : '—';

  const current = assignments[0] || null;
  const previous = assignments.slice(1).find((a) => a.season_id !== current?.season_id) || null;
  const titles = (
    await db
      .prepare(
        `SELECT COUNT(*) AS n FROM seasons s
         JOIN season_players sp ON sp.season_id = s.id
         WHERE s.winner_team_id = sp.team_id AND sp.player_id = ?`
      )
      .get(playerId)
  ).n;

  return { player, careerBat, careerBowl, seasons: perSeason, current, previous, titles };
}

export async function globalRecords(seasonId = null, limit = 10) {
  const { batting, bowling } = await aggregateStats({ seasonId });
  const players = new Map(
    (await db.prepare('SELECT id, name FROM players').all()).map((p) => [p.id, p])
  );
  const titles = await db
    .prepare(
      `SELECT t.id, t.name, t.short_name, t.color, COUNT(*) AS titles
       FROM seasons s JOIN teams t ON t.id = s.winner_team_id
       WHERE s.status = 'completed' AND s.winner_team_id IS NOT NULL
         ${seasonId ? 'AND s.id = ?' : ''}
       GROUP BY t.id ORDER BY titles DESC, t.name`
    )
    .all(...(seasonId ? [seasonId] : []));

  /* Every list is the same shape: the leading names, already ranked, so the
     record book can show the top 10 or the top 100 of anything. */
  const board = (rows, compare, keep = () => true) =>
    rows
      .filter(keep)
      .map((r) => ({ ...r, name: players.get(r.playerId)?.name || 'Unknown' }))
      .sort(compare)
      .slice(0, limit);

  const batted = batting.filter((r) => r.innings > 0);
  const bowled = bowling.filter((r) => r.innings > 0);

  const battingBoards = {
    runs: board(batted, (a, b) => b.runs - a.runs || b.highScore - a.highScore),
    highScore: board(
      batted,
      (a, b) => b.highScore - a.highScore || b.runs - a.runs,
      (r) => r.highScore > 0
    ),
    hundreds: board(batted, (a, b) => b.hundreds - a.hundreds || b.runs - a.runs, (r) => r.hundreds > 0),
    fifties: board(batted, (a, b) => b.fifties - a.fifties || b.runs - a.runs, (r) => r.fifties > 0),
    sixes: board(batted, (a, b) => b.sixes - a.sixes || b.runs - a.runs, (r) => r.sixes > 0),
    fours: board(batted, (a, b) => b.fours - a.fours || b.runs - a.runs, (r) => r.fours > 0),
    strikeRate: board(batted, (a, b) => b.strikeRate - a.strikeRate || b.runs - a.runs, (r) => r.balls >= 30),
    average: board(batted, (a, b) => b.average - a.average || b.runs - a.runs, (r) => r.outs >= 3),
  };

  const bowlingBoards = {
    wickets: board(bowled, (a, b) => b.wickets - a.wickets || a.runs - b.runs),
    fiveWicketHauls: board(
      bowled,
      (a, b) => b.fiveWicketHauls - a.fiveWicketHauls || b.wickets - a.wickets,
      (r) => r.fiveWicketHauls > 0
    ),
    best: board(
      bowled,
      (a, b) => b.bestWickets - a.bestWickets || a.bestRuns - b.bestRuns || b.wickets - a.wickets,
      (r) => r.bestWickets > 0
    ),
    economy: board(bowled, (a, b) => a.economy - b.economy || b.wickets - a.wickets, (r) => r.balls >= 30),
    average: board(bowled, (a, b) => a.average - b.average || b.wickets - a.wickets, (r) => r.wickets >= 3),
    catches: board(bowling, (a, b) => b.catches - a.catches || b.runOuts - a.runOuts, (r) => r.catches > 0),
  };

  return {
    limit,
    mostRuns: battingBoards.runs[0] || null,
    mostWickets: bowlingBoards.wickets[0] || null,
    battingBoards,
    bowlingBoards,
    titles,
    seasons: await db.prepare("SELECT * FROM seasons WHERE status = 'completed' ORDER BY id DESC").all(),
    allSeasons: await db.prepare('SELECT id, name, format, status FROM seasons ORDER BY id DESC').all(),
    totalRuns: batting.reduce((s, r) => s + r.runs, 0),
    totalWickets: bowling.reduce((s, r) => s + r.wickets, 0),
  };
}

export { emptyBat, emptyBowl };
