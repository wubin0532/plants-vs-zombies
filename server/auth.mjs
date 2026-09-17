import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { loadSecret } from './store.mjs';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const sessionTtlSeconds = Math.floor(SESSION_TTL_MS / 1000);

export async function createPasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return { salt: salt, hash: derived.toString('hex') };
}

export async function verifyPassword(password, user) {
  if (!user || !user.salt || !user.hash) return false;
  const derived = await scryptAsync(password, user.salt, KEY_LENGTH);
  const expected = Buffer.from(user.hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export async function createSession(userId) {
  const secret = await loadSecret();
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = userId + '.' + expires;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

export async function readSession(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const userId = parts[0];
  const expiresRaw = parts[1];
  const signature = parts[2];
  if (!userId || !expiresRaw || !signature) return null;
  const secret = await loadSecret();
  const payload = userId + '.' + expiresRaw;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const given = Buffer.from(signature);
  const check = Buffer.from(expected);
  if (given.length !== check.length || !timingSafeEqual(given, check)) return null;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  return userId;
}
