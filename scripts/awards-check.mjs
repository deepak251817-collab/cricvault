/* Checks the new award numbers against a completed match and drives the
   player-of-the-match route end to end.
   CRICVAULT_DB=data/_perf.db node scripts/awards-check.mjs */
import { spawn } from 'node:child_process';
import { ready, db } from '../server/db.js';
import { globalRecords, playerCareer, teamAnalytics } from '../server/engine.js';

await ready;

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};

const records = await globalRecords(null, 10);
const fifties = records.battingBoards.fastestFifty;
const hundreds = records.battingBoards.fastestHundred;
check('fastest fifty board filled', fifties.length > 0, `${fifties.length} rows`);
check(
  'fastest fifty is the lowest ball count',
  fifties.every((row, i) => i === 0 || fifties[i - 1].fastestFifty <= row.fastestFifty),
  fifties.slice(0, 3).map((r) => `${r.name} ${r.fastestFifty}b`).join(', '),
);
check(
  'fastest hundred needs a hundred',
  hundreds.every((row) => row.hundreds > 0),
  hundreds.slice(0, 2).map((r) => `${r.name} ${r.fastestHundred}b`).join(', '),
);

const keeper = records.bowlingBoards.stumpings[0];
if (keeper) {
  const career = await playerCareer(keeper.playerId);
  check('stumpings reach the career card', career.careerBowl.stumpings >= 1, String(career.careerBowl.stumpings));
  check('player of the match count present', typeof career.playerOfMatch === 'number', String(career.playerOfMatch));
}

const team = await teamAnalytics(1, 1);
const stumper = team?.players?.find((p) => (p.bowling.stumpings || 0) > 0);
if (stumper) {
  const withoutStumpings = stumper.batting.runs + stumper.bowling.wickets * 20 + stumper.bowling.catches * 8 + stumper.bowling.runOuts * 6;
  check(
    'impact counts stumpings',
    stumper.impact === withoutStumpings + stumper.bowling.stumpings * 8,
    `${stumper.name}: ${stumper.impact} vs ${withoutStumpings}`,
  );
}

// The route: name a player of the match and read it back off the card.
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: '8098', NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

const BASE = 'http://127.0.0.1:8098';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, data: await res.json() };
}

try {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(BASE + '/api/health')).ok) break;
    } catch {
      /* still starting */
    }
    await sleep(250);
  }

  check('login', (await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })).status === 200);

  const state = await call('/api/matches/1');
  const pick = state.data.xi[0];
  const awarded = await call('/api/matches/1/player-of-match', {
    method: 'POST',
    body: JSON.stringify({ playerId: pick.player_id }),
  });
  check('award player of the match', awarded.status === 200 && !!awarded.data.playerOfMatch,
    awarded.status === 200 ? `${awarded.data.playerOfMatch.name}` : JSON.stringify(awarded.data));
  check('awarded name matches the XI', awarded.data.playerOfMatch?.playerId === pick.player_id);
  check('potm count follows on the career card', (await call(`/api/players/${pick.player_id}`)).data.playerOfMatch === 1);

  const outsider = state.data.xi.length ? 99999 : 0;
  const rejected = await call('/api/matches/1/player-of-match', {
    method: 'POST',
    body: JSON.stringify({ playerId: outsider }),
  });
  check('a player outside the XI is refused', rejected.status === 400, rejected.data.error || '');

  const cleared = await call('/api/matches/1/player-of-match', {
    method: 'POST',
    body: JSON.stringify({ playerId: null }),
  });
  check('award can be cleared', cleared.status === 200 && cleared.data.playerOfMatch === null);
} finally {
  server.kill();
  await db.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
