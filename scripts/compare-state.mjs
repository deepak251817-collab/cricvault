/* Compares the state and scorecard payloads from the previous engine with the
   batched one, so a faster read path is proven to return the same thing.
   CRICVAULT_DB=data/_perf.db MATCH_ID=1 node scripts/compare-state.mjs */
import { execSync } from 'node:child_process';
import { ready } from '../server/db.js';

execSync('git show HEAD:server/engine.js > server/_old_engine.js');

const oldEngine = await import('../server/_old_engine.js?before');
const newEngine = await import('../server/engine.js');
await ready;

function diff(a, b, at = '', out = []) {
  if (out.length > 40) return out;
  if (a === b) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) {
    out.push(`${at}: ${ta}(${JSON.stringify(a)?.slice(0, 80)}) -> ${tb}(${JSON.stringify(b)?.slice(0, 80)})`);
    return out;
  }
  if (ta === 'array') {
    if (a.length !== b.length) out.push(`${at}: length ${a.length} -> ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diff(a[i], b[i], `${at}[${i}]`, out);
    return out;
  }
  if (ta === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[key], b[key], `${at}.${key}`, out);
    return out;
  }
  out.push(`${at}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  return out;
}

const ids = (process.env.MATCH_ID || '1,2').split(',').map(Number);
let failures = 0;

for (const id of ids) {
  for (const name of ['getMatchState', 'getScorecard']) {
    let before;
    let after;
    try {
      before = JSON.parse(JSON.stringify(await oldEngine[name](id) ?? null));
      after = JSON.parse(JSON.stringify(await newEngine[name](id) ?? null));
    } catch (err) {
      console.log(`${name}(${id}): ERROR ${err.message}`);
      failures += 1;
      continue;
    }
    const diffs = diff(before, after);
    if (!diffs.length) console.log(`${name}(${id}): identical`);
    else {
      failures += 1;
      console.log(`${name}(${id}): ${diffs.length} differences`);
      for (const line of diffs) console.log('   ', line);
    }
  }
}

console.log(failures ? `${failures} comparisons differ` : 'all comparisons identical');
process.exit(failures ? 1 : 0);
