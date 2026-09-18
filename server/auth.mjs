import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { loadSecret } from './store.mjs';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 登录/注册都要走一次 scrypt（未知用户用固定 dummy 参数），避免计时侧信道。 */
const DUMMY_SALT = '00000000000000000000000000000000';
export async function burnPasswordWork(password) {
  await scryptAsync(String(password || ''), DUMMY_SALT, KEY_LENGTH);
}

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

export async function createSession(userId, sessionVersion) {
  const secret = await loadSecret();
  const expires = Date.now() + SESSION_TTL_MS;
  const version = Number(sessionVersion) || 0;
  const payload = userId + '.' + version + '.' + expires;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

/**
 * 返回 `{ userId, version }` 或 null。签名与 TTL 校验通过后，
 * 由调用方再比对用户当前的 sessionVersion（登出后旧 token 立即失效）。
 */
export async function readSession(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const userId = parts[0];
  const versionRaw = parts[1];
  const expiresRaw = parts[2];
  const signature = parts[3];
  if (!userId || versionRaw === '' || !expiresRaw || !signature) return null;
  const secret = await loadSecret();
  const payload = userId + '.' + versionRaw + '.' + expiresRaw;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const given = Buffer.from(signature);
  const check = Buffer.from(expected);
  if (given.length !== check.length || !timingSafeEqual(given, check)) return null;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const version = Number(versionRaw);
  if (!Number.isInteger(version) || version < 0) return null;
  return { userId: userId, version: version };
}
