/**
 * Copies the local SQLite database (data/cricvault.db) into the hosted libSQL
 * database configured by TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.
 *
 * Usage (reads credentials from the environment, never from argv):
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/push-to-turso.mjs
 *
 * The local file is only ever read. The remote database is created/updated in
 * place; existing rows in the copied tables are replaced, ids are preserved so
 * every foreign key stays valid.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC_PATH = process.env.CRICVAULT_DB || path.join(ROOT, 'data', 'cricvault.db');
const TARGET_URL = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
const TARGET_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;

if (!TARGET_URL) {
  console.error(
    'Set TURSO_DATABASE_URL (libsql://...) and TURSO_AUTH_TOKEN before running this script.'
  );
  process.exit(1);
}
if (!TARGET_URL.startsWith('libsql://')) {
  console.warn(`Warning: ${TARGET_URL} is not a hosted libSQL URL; copying into it as-is.`);
}
if (!fs.existsSync(SRC_PATH)) {
  console.error(`Local database not found: ${SRC_PATH}`);
  process.exit(1);
}

const source = createClient({ url: `file:${SRC_PATH}` });

// Insert parents first; delete children first, so foreign keys stay satisfied.
const INSERT_ORDER = [
  'teams',
  'players',
  'users',
  'sessions',
  'seasons',
  'season_teams',
  'season_players',
  'matches',
  'innings',
  'deliveries',
  'match_xi',
  'settings',
];
const TABLES = [...INSERT_ORDER].reverse();

const { db, ready } = await import('../server/db.js');
await ready;

const targetCounts = {};
for (const table of TABLES) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  targetCounts[table] = Number(row?.n || 0);
}
const targetHasData = Object.values(targetCounts).some((n) => n > 0);

if (targetHasData && !process.argv.includes('--force')) {
  console.error('The target database already contains data:');
  for (const [table, n] of Object.entries(targetCounts)) {
    if (n > 0) console.error(`  ${table}: ${n}`);
  }
  console.error('Re-run with --force to overwrite those tables from the local file.');
  process.exit(1);
}

const sourceRows = {};
for (const table of INSERT_ORDER) {
  sourceRows[table] = (await source.execute(`SELECT * FROM ${table}`)).rows;
}

const summary = {};
for (const table of TABLES) {
  if (targetHasData) await db.prepare(`DELETE FROM ${table}`).run();
}

for (const table of INSERT_ORDER) {
  const rows = sourceRows[table];
  summary[table] = rows.length;
  if (!rows.length) continue;

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => '?').join(', ');
  const insert = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
  );

  const copyTable = db.transaction(async () => {
    for (const row of rows) {
      await insert.run(...columns.map((c) => (row[c] === undefined ? null : row[c])));
    }
  });
  await copyTable();
}

await source.close();
await db.close();

console.log('Copied rows to', TARGET_URL.replace(/^libsql:\/\//, 'libsql://'));
for (const [table, n] of Object.entries(summary)) console.log(`  ${table}: ${n}`);
