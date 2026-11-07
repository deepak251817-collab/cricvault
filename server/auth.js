import crypto from 'node:crypto';
import { db, now } from './db.js';

export const SESSION_COOKIE = 'cv_session';
const SESSION_DAYS = 30;

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(
    token,
    userId,
    now(),
    expiresAt
  );
  return { token, expiresAt };
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function sessionUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.team_id, u.display_name, t.name AS team_name, t.short_name AS team_short,
              s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN teams t ON t.id = u.team_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  const { expires_at, ...user } = row;
  void expires_at;
  return user;
}

export function attachUser(req, res, next) {
  req.user = sessionUser(req);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

export function sameTeamOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (req.user.role === 'admin') return next();
  const raw = req.params.id ?? req.body?.teamId ?? req.query?.teamId;
  const id = Number(raw);
  if (!id || id !== req.user.team_id) return res.status(403).json({ error: 'You can only view your own team' });
  next();
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: false,
  path: '/',
  maxAge: SESSION_DAYS * 86400000,
};
