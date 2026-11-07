import { createRouter } from '../router.js';
import { db, hashPassword, verifyPassword, getSetting } from '../db.js';
import {
  createSession,
  destroySession,
  SESSION_COOKIE,
  cookieOptions,
  requireAuth,
} from '../auth.js';

const router = createRouter();

router.get('/bootstrap', async (req, res) => {
  const leagueName = await getSetting('league_name', 'The Cricket League');
  const seasons = await db
    .prepare(
      `SELECT s.*, t.name AS winner_name, t.short_name AS winner_short
       FROM seasons s LEFT JOIN teams t ON t.id = s.winner_team_id
       ORDER BY s.created_at DESC, s.id DESC`
    )
    .all();
  const teams = await db
    .prepare('SELECT id, name, short_name, color FROM teams WHERE is_active = 1 ORDER BY name')
    .all();
  res.json({ user: req.user || null, leagueName, seasons, teams });
});

router.post('/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const row = await db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const { token, expiresAt } = await createSession(row.id);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  const team = row.team_id ? await db.prepare('SELECT name, short_name FROM teams WHERE id = ?').get(row.team_id) : null;
  res.json({
    user: {
      id: row.id,
      username: row.username,
      role: row.role,
      team_id: row.team_id,
      display_name: row.display_name,
      team_name: team?.name || null,
      team_short: team?.short_name || null,
    },
    expiresAt,
  });
});

router.post('/auth/logout', async (req, res) => {
  await destroySession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

router.get('/auth/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  res.json({ user: req.user });
});

router.post('/auth/password', requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current, row.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.cookies?.[SESSION_COOKIE] || '');
  res.json({ ok: true });
});

router.get('/settings', requireAuth, async (req, res) => {
  res.json({
    leagueName: await getSetting('league_name', 'The Cricket League'),
    seasons: await db.prepare('SELECT id, name, status FROM seasons ORDER BY id DESC').all(),
  });
});

router.patch('/settings', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const name = String(req.body?.leagueName || '').trim();
  if (!name) return res.status(400).json({ error: 'League name is required' });
  await db.prepare(
    `INSERT INTO settings (key, value) VALUES ('league_name', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(name);
  res.json({ leagueName: name });
});

export default router;
