import http from 'node:http';
import {
  bumpSessionVersion,
  createUser,
  findUserById,
  findUserByName,
  loadUsers,
  maxUsers,
  readSave,
  touchLogin,
  writeSave,
} from './store.mjs';
import {
  burnPasswordWork,
  createPasswordHash,
  createSession,
  readSession,
  sessionTtlSeconds,
  verifyPassword,
} from './auth.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE_NAME = 'pvz_session';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
// 仅当本服务只被受信反向代理访问时开启；开启后按 X-Real-IP（代理覆盖写）计数。
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_BODY = 300 * 1024;
const MAX_SAVE = 256 * 1024;
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.RATE_LIMIT_MAX || 20);
// PUT /api/save 的宽松上限：客户端自动保存有 2s 防抖（src/store.ts），
// 峰值约 30 次/分钟，取 2 倍余量；超限只影响该用户自己的存档写入。
const MAX_SAVE_WRITES = Number(process.env.SAVE_RATE_LIMIT_MAX || 60);

function makeRateLimiter(maxPerWindow) {
  const hits = new Map();
  let lastSweep = 0;
  return function limited(key) {
    const now = Date.now();
    // 惰性清理：至多每秒全表扫一次，剔除窗口已过期的条目，
    // 避免 hits 随独立 IP 数只增不减（长进程内存泄漏）。
    if (now - lastSweep > 1000) {
      lastSweep = now;
      for (const [k, entry] of hits) {
        if (now > entry.reset) hits.delete(k);
      }
    }
    const entry = hits.get(key);
    if (!entry || now > entry.reset) {
      // 过期条目直接以新窗口覆盖重建，旧记录不驻留
      hits.set(key, { count: 1, reset: now + WINDOW_MS });
      return false;
    }
    entry.count += 1;
    return entry.count > maxPerWindow;
  };
}

const authLimited = makeRateLimiter(MAX_ATTEMPTS);
const saveWriteLimited = makeRateLimiter(MAX_SAVE_WRITES);

function clientIp(req) {
  // 默认只信 TCP 来源地址，防止伪造 X-Forwarded-For / X-Real-IP 绕过限流。
  // 仅当部署在受信反代之后并显式设置 TRUST_PROXY=1 时，才采用代理覆盖写的 X-Real-IP。
  // 注意：此时必须保证客户端无法绕过反代直连本端口（不对外发布该端口）。
  if (TRUST_PROXY) {
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function send(res, status, payload, headers) {
  const body = JSON.stringify(payload);
  const base = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  };
  res.writeHead(status, Object.assign(base, headers || {}));
  res.end(body);
}

/** 浏览器跨站写请求的纵深防御：Origin 与 Host 不一致则拒绝。 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return true;
  try {
    return new URL(origin).host === host;
  } catch (error) {
    return false;
  }
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    let settled = false;
    const chunks = [];
    function fail(code) {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      const error = new Error(code);
      reject(error);
      // 先让调用方有机会响应，再停止接收剩余 body（不在这里 destroy）。
      req.pause();
    }
    req.on('data', function (chunk) {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        fail('BODY_TOO_LARGE');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
        resolve(parsed);
      } catch (error) {
        reject(new Error('BAD_JSON'));
      }
    });
    req.on('error', function (error) {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch (error) {
      out[key] = part.slice(index + 1).trim();
    }
  }
  return out;
}

function sessionCookie(value) {
  const bits = [
    COOKIE_NAME + '=' + value,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + sessionTtlSeconds,
  ];
  if (COOKIE_SECURE) bits.push('Secure');
  return bits.join('; ');
}

function clearCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

async function currentUser(req) {
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const session = await readSession(raw);
  if (!session) return null;
  const user = await findUserById(session.userId);
  if (!user) return null;
  // 会话版本不匹配说明该 token 已被登出 / 改密作废。
  if ((Number(user.sessionVersion) || 0) !== session.version) return null;
  return user;
}

function publicUser(user) {
  return { id: user.id, name: user.name, createdAt: user.createdAt };
}

function validName(name) {
  if (typeof name !== 'string') return false;
  const value = name.trim();
  if (value.length < 1 || value.length > 20) return false;
  for (const ch of value) {
    if (ch.trim() === '') return false;
    if (ch < ' ') return false;
  }
  return true;
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 4 && password.length <= 128;
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const rawPath = url.pathname;
  const pathname = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
  const method = req.method || 'GET';
  const ip = clientIp(req);
  const mutating = method === 'POST' || method === 'PUT' || method === 'DELETE';
  if (mutating && !sameOrigin(req)) {
    return send(res, 403, { error: '跨站请求被拒绝' });
  }

  if (pathname === '/api/health' && method === 'GET') {
    const users = await loadUsers();
    return send(res, 200, { ok: true, users: users.length, maxUsers: maxUsers() });
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    if (authLimited(ip)) return send(res, 429, { error: '请求过于频繁，请稍后再试' });
    const body = await readBody(req);
    if (!validName(body.username)) return send(res, 400, { error: '用户名需为 1-20 位、不含空格' });
    if (!validPassword(body.password)) return send(res, 400, { error: '密码长度需为 8-128 位' });
    const existing = await findUserByName(body.username);
    if (existing) {
      // 与成功路径一样付出一次 scrypt，缩小“是否已存在”的计时差。
      await burnPasswordWork(body.password);
      return send(res, 409, { error: '用户名已存在' });
    }
    const hashed = await createPasswordHash(body.password);
    const user = await createUser(body.username, hashed.salt, hashed.hash);
    const token = await createSession(user.id, user.sessionVersion);
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (authLimited(ip)) return send(res, 429, { error: '请求过于频繁，请稍后再试' });
    const body = await readBody(req);
    const user = await findUserByName(String(body.username || ''));
    if (!user) {
      // 用户不存在也执行等价工作量，避免通过响应时间枚举用户名。
      await burnPasswordWork(body.password);
      return send(res, 401, { error: '用户名或密码不正确' });
    }
    const ok = await verifyPassword(String(body.password || ''), user);
    if (!ok) return send(res, 401, { error: '用户名或密码不正确' });
    await touchLogin(user.id);
    const token = await createSession(user.id, user.sessionVersion);
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    // 递增会话版本，令该用户已签发的 token 立即失效（而不仅是清 Cookie）。
    const user = await currentUser(req);
    if (user) await bumpSessionVersion(user.id);
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: '未登录' });
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/save' && method === 'GET') {
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: '未登录' });
    return send(res, 200, { save: await readSave(user.id) });
  }

  if (pathname === '/api/save' && method === 'PUT') {
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: '未登录' });
    if (saveWriteLimited(user.id)) return send(res, 429, { error: '保存过于频繁，请稍后再试' });
    const body = await readBody(req);
    const data = body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, { error: '存档格式不正确' });
    if (data.version !== 1 && data.version !== 2) return send(res, 400, { error: '存档版本不受支持' });
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized) > MAX_SAVE) return send(res, 413, { error: '存档过大' });
    const baseUpdatedAt =
      body.baseUpdatedAt === undefined || body.baseUpdatedAt === null
        ? undefined
        : Number(body.baseUpdatedAt);
    if (baseUpdatedAt !== undefined && !Number.isFinite(baseUpdatedAt)) {
      return send(res, 400, { error: 'baseUpdatedAt 不合法' });
    }
    const payload = await writeSave(user.id, data, baseUpdatedAt);
    return send(res, 200, { updatedAt: payload.updatedAt });
  }

  return send(res, 404, { error: '接口不存在' });
}

const server = http.createServer(function (req, res) {
  route(req, res).catch(function (error) {
    try {
      if (error && error.message === 'BAD_JSON') {
        return send(res, 400, { error: '请求内容不是合法 JSON' });
      }
      if (error && error.message === 'BODY_TOO_LARGE') {
        send(res, 413, { error: '请求内容过大' });
        // 响应已发出，再断开还在推送的请求。
        req.destroy();
        return;
      }
      if (error && error.code === 'SAVE_CONFLICT') {
        return send(res, 409, { error: '存档已在其他设备更新', save: error.current });
      }
      if (error && (error.code === 'USER_EXISTS' || error.code === 'USER_LIMIT')) {
        return send(res, 409, { error: error.message });
      }
      console.error('[garden-api]', error);
      return send(res, 500, { error: '服务器内部错误' });
    } catch (sendError) {
      // 响应已经/无法发出时的最后兜底，避免二次抛错变成未处理拒绝。
      try {
        res.destroy();
      } catch (destroyError) {
        /* ignore */
      }
    }
  });
});

server.listen(PORT, HOST, function () {
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : PORT;
  console.log('[garden-api] listening on http://' + HOST + ':' + actualPort);
  console.log('[garden-api] data dir: ' + (process.env.DATA_DIR || '(default ./data)'));
});
