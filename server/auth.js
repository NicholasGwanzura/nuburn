import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { db } from './db.js';

const COOKIE = 'nuburn_admin';
const SESSION_DAYS = 14;

const hash = (value) => createHash('sha256').update(String(value)).digest();

export function passwordMatches(input) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(hash(input), hash(expected));
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function createSession(res, secure) {
  const token = randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expires);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 864e5, path: '/' });
}

export function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

export function isAdmin(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  return Boolean(row && row.expires_at > Date.now());
}

export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Please sign in.' });
}
