import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { loadSecret } from './store.mjs';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 口令哈希参数。
 *
 * Node 的 scrypt 默认 N=16384（16 MiB），低于 OWASP 现在建议的 2^17。这里把新
 * 注册/改密的口令提到 N=2^17，并**把参数写进哈希串**（`v1$N$r$p$hash`），因此：
 * - 老库里的裸 hex 哈希仍然可用（按旧参数校验，见 LEGACY_PARAMS）；
 * - 校验成功后由调用方决定是否用 planPasswordMigration() 顺手升级（见 index.mjs），
 *   不需要强制所有人改密。
 * maxmem 必须显式给足，否则 N=2^17/r=8 会超过 Node 的默认内存上限直接报错。
 */
const SCRYPT_PARAMS = { N: 1 << 17, r: 8, p: 1 };
const LEGACY_PARAMS = { N: 1 << 14, r: 8, p: 1 };
const MAX_MEM = 512 * 1024 * 1024;

function scryptOptions(params) {
  return {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: MAX_MEM,
  };
}

function encodeHash(params, derived) {
  return 'v1$' + params.N + '$' + params.r + '$' + params.p + '$' + derived.toString('hex');
}

/** 解析存量哈希；无法识别时返回 null（宁可拒绝登录，也不放宽校验）。 */
function decodeHash(stored) {
  if (typeof stored !== 'string' || !stored) return null;
  const parts = stored.split('$');
  if (parts.length === 5 && parts[0] === 'v1') {
    const [, n, r, p, hex] = parts;
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    if (
      !Number.isInteger(params.N) ||
      !Number.isInteger(params.r) ||
      !Number.isInteger(params.p) ||
      params.N < 2 ||
      params.r < 1 ||
      params.p < 1
    )
      return null;
    return { params, hex };
  }
  // 旧格式：裸 hex，参数为当时的默认值。
  if (/^[0-9a-f]+$/i.test(stored)) return { params: LEGACY_PARAMS, hex: stored };
  return null;
}

/** 是否需要用当前参数重算（登录成功后顺手升级）。 */
export function hashNeedsMigration(stored) {
  const decoded = decodeHash(stored);
  if (!decoded) return false;
  return decoded.params.N !== SCRYPT_PARAMS.N;
}

/** 登录/注册都要走一次 scrypt（未知用户用固定 dummy 参数），避免计时侧信道。 */
const DUMMY_SALT = '00000000000000000000000000000000';
export async function burnPasswordWork(password) {
  await scryptAsync(String(password || ''), DUMMY_SALT, KEY_LENGTH, scryptOptions(SCRYPT_PARAMS));
}

export const sessionTtlSeconds = Math.floor(SESSION_TTL_MS / 1000);

export async function createPasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEY_LENGTH, scryptOptions(SCRYPT_PARAMS));
  return { salt: salt, hash: encodeHash(SCRYPT_PARAMS, derived) };
}

export async function verifyPassword(password, user) {
  if (!user || !user.salt || !user.hash) return false;
  const decoded = decodeHash(user.hash);
  if (!decoded) return false;
  const derived = await scryptAsync(password, user.salt, KEY_LENGTH, scryptOptions(decoded.params));
  const expected = Buffer.from(decoded.hex, 'hex');
  if (expected.length !== KEY_LENGTH || derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * 与 verifyPassword 同样的校验，但校验通过且哈希还是旧参数时，
 * 用当前参数重算一份（返回可写回用户的 salt/hash）。否则返回 null。
 */
export async function planPasswordMigration(password, user) {
  if (!user || !hashNeedsMigration(user.hash)) return null;
  if (!(await verifyPassword(password, user))) return null;
  const upgraded = await createPasswordHash(password);
  return { salt: upgraded.salt, hash: upgraded.hash };
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
