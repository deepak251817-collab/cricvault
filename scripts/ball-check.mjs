/* Walks the scoring API on a scratch copy of the database: load the console,
   score a ball, then read the card, timing each call.
   CRICVAULT_DB=data/_perf.db node scripts/ball-check.mjs */
import { spawn } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099';
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: '8099', NODE_ENV: 'production', CRICVAULT_DB: process.env.CRICVAULT_DB },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};

try {
  for (let i = 0; i < 60; i += 1) {
    try {
      const health = await fetch(BASE + '/api/health');
      if (health.ok) break;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  check('login', login.status === 200);

  let started = performance.now();
  const state = await call('/api/matches/1');
  const loadMs = performance.now() - started;
  check('GET /matches/1', state.status === 200, `${loadMs.toFixed(0)}ms`);
  let current = state.data.current;
  check('console arrives with a live innings', !!current);

  // A fresh chase has no one at the crease yet, so name openers and a bowler.
  if (!current.strikerId || !current.nonStrikerId || !current.bowlerId) {
    const batters = state.data.xi.filter((x) => x.team_id === current.battingTeamId && !x.is_wk);
    const bowlers = state.data.xi.filter((x) => x.team_id === current.bowlingTeamId && !x.is_wk);
    const openers = await call('/api/matches/1/openers', {
      method: 'POST',
      body: JSON.stringify({
        inningsId: current.inningsId,
        strikerId: batters[0].player_id,
        nonStrikerId: batters[1].player_id,
        bowlerId: bowlers[0].player_id,
      }),
    });
    check('openers set', openers.status === 200, openers.status === 200 ? '' : JSON.stringify(openers.data));
    if (openers.status === 200) current = openers.data.current;
  }

  started = performance.now();
  const ball = await call('/api/matches/1/balls', {
    method: 'POST',
    body: JSON.stringify({
      inningsId: current.inningsId,
      strikerId: current.strikerId,
      nonStrikerId: current.nonStrikerId,
      bowlerId: current.bowlerId,
      runs: 1,
    }),
  });
  const ballMs = performance.now() - started;
  check('POST /balls', ball.status === 200, `${ballMs.toFixed(0)}ms`);
  check(
    'the run landed',
    ball.status === 200 && ball.data.current.runs === current.runs + 1,
    ball.status === 200 ? `${current.runs} -> ${ball.data.current.runs}` : JSON.stringify(ball.data),
  );

  started = performance.now();
  const card = await call('/api/matches/1/scorecard');
  const cardMs = performance.now() - started;
  check('GET /scorecard', card.status === 200, `${cardMs.toFixed(0)}ms`);
  const cards = card.status === 200 ? card.data.cards : [];
  check('both innings on the card', cards.length === 2, `${cards.length} innings`);
  const unnamed = cards.flatMap((c) => [...c.batting, ...c.bowling]).filter((row) => !row.name || row.name === 'Unknown');
  check('every card row has a name', unnamed.length === 0, `${unnamed.length} unnamed`);
  check(
    'batting lines cover the XI',
    cards.length === 2 && cards.every((c) => c.batting.length >= 11),
    cards.map((c) => c.batting.length).join('/'),
  );
  const totals = cards.reduce((sum, c) => sum + c.runs, 0);
  check('innings totals still match the card', totals >= 1, `${totals} runs`);
  check('over groups present', cards.every((c) => c.overGroups.length > 0));
  check('partnership names resolved', cards.every((c) => (c.partnerships || []).every((p) => p.aName)));
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
