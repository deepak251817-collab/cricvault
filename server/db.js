import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = process.env.CRICVAULT_DB || path.join(DATA_DIR, 'cricvault.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  short_name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#2f6b3f',
  home_ground TEXT,
  logo TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'batter'
    CHECK (role IN ('batter','bowler','allrounder','wicketkeeper')),
  bowl_style TEXT CHECK (bowl_style IN ('fast','medium','spin') OR bowl_style IS NULL),
  batting_style TEXT CHECK (batting_style IN ('right','left') OR batting_style IS NULL),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','team')),
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('t20','odi','test','custom')),
  overs_per_innings INTEGER,
  innings_limit INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','fixtures','live','playoffs','completed')),
  playoff_teams INTEGER DEFAULT 4,
  winner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  runner_up_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  starts_on TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS season_teams (
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (season_id, team_id)
);

CREATE TABLE IF NOT EXISTS season_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  is_captain INTEGER NOT NULL DEFAULT 0,
  is_wicketkeeper INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  UNIQUE (season_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_sp_season_team ON season_players(season_id, team_id);
CREATE INDEX IF NOT EXISTS idx_sp_player ON season_players(player_id);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'league' CHECK (stage IN ('league','playoff')),
  match_no INTEGER,
  stage_name TEXT,
  team_a_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  team_b_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  venue TEXT,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','live','completed','abandoned')),
  format TEXT NOT NULL,
  overs INTEGER,
  innings_limit INTEGER NOT NULL DEFAULT 2,
  toss_winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  toss_decision TEXT CHECK (toss_decision IN ('bat','bowl') OR toss_decision IS NULL),
  winner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  result_type TEXT CHECK (result_type IN ('win','tie','no_result','draw') OR result_type IS NULL),
  result_text TEXT,
  team_a_points INTEGER DEFAULT 0,
  team_b_points INTEGER DEFAULT 0,
  bracket_key TEXT,
  seed_a TEXT,
  seed_b TEXT,
  winner_to TEXT,
  loser_to TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

CREATE TABLE IF NOT EXISTS innings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings_no INTEGER NOT NULL,
  batting_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  bowling_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  target INTEGER,
  declared INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  current_striker_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  current_non_striker_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  current_bowler_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (match_id, innings_no)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings_id INTEGER NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  over_no INTEGER NOT NULL,
  ball_no INTEGER NOT NULL,
  batter_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  non_striker_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  bowler_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  runs INTEGER NOT NULL DEFAULT 0,
  extra_type TEXT CHECK (extra_type IN ('wd','nb','b','lb') OR extra_type IS NULL),
  extra_runs INTEGER NOT NULL DEFAULT 0,
  is_wicket INTEGER NOT NULL DEFAULT 0,
  wicket_type TEXT,
  dismissed_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  fielder_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_del_innings ON deliveries(innings_id, id);
CREATE INDEX IF NOT EXISTS idx_del_match ON deliveries(match_id);

CREATE TABLE IF NOT EXISTS match_xi (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  is_captain INTEGER NOT NULL DEFAULT 0,
  is_wk INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

db.exec(SCHEMA);

/* ---------------- helpers ---------------- */

export const now = () => new Date().toISOString();

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value == null ? null : String(value));
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/* ---------------- seed ---------------- */

const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  db.prepare(
    `INSERT INTO users (username, password_hash, role, display_name, created_at)
     VALUES (?, ?, 'admin', 'League Admin', ?)`
  ).run('admin', hashPassword('admin123'), now());
}
if (getSetting('league_name') == null) setSetting('league_name', 'The Cricket League');

export const ROOT_DIR = ROOT;
