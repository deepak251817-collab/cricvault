/* Counts the database round trips behind the read paths that gate page loads,
   and re-times them with a simulated hosted-database hop, since a local SQLite
   file answers instantly and hides the cost a deployed Turso database adds.

   SIM_MS=40 MATCH_ID=1 node scripts/perf-bench.mjs */
import { client, ready } from '../server/db.js';
import { getMatchState, getScorecard } from '../server/engine.js';

const delay = Number(process.env.SIM_MS ?? 40);
let hops = 0;

for (const method of ['execute', 'executeMultiple', 'batch']) {
  const original = client[method]?.bind(client);
  if (!original) continue;
  client[method] = async (...args) => {
    hops += 1;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return original(...args);
  };
}

await ready;
const matchId = Number(process.env.MATCH_ID || 1);

async function timed(label, fn) {
  hops = 0;
  const started = performance.now();
  try {
    await fn();
  } catch (err) {
    console.log(`${label}: ERROR ${err.message}`);
    return;
  }
  console.log(`${label}: ${hops} round trips, ${(performance.now() - started).toFixed(0)}ms at ${delay}ms/hop`);
}

await timed(`GET /matches/${matchId} (scoring console)`, () => getMatchState(matchId));
await timed(`GET /matches/${matchId}/scorecard`, () => getScorecard(matchId));
process.exit(0);
