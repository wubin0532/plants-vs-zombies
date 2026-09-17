import http from 'node:http';
import {
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
  // 信任前提：仅在 nginx 反代之后部署时可信——deploy/nginx-garden-api.conf
  // 会写入 X-Real-IP 并把客户端地址追加进 X-Forwarded-For，此时首跳是真实客户端。
  // 若客户端可绕过反代直连本服务，这两个头均可伪造（可用来规避限流或“转移”限流），
  // 那种部署方式下应删掉下面的头部解析、只认 remoteAddress。
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  return req.socket.remoteAddress || 'unknown';
}

function send(res, status, payload, headers) {
  const body = JSON.stringify(payload);
  const base = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  };
  res.writeHead(status, Object.assign(base, headers || {}));
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        const error = new Error('BODY_TOO_LARGE');
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
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
    req.on('error', reject);
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
  const userId = await readSession(raw);
  if (!userId) return null;
  return findUserById(userId);
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

  if (pathname === '/api/health' && method === 'GET') {
    const users = await loadUsers();
    return send(res, 200, { ok: true, users: users.length, maxUsers: maxUsers() });
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    if (authLimited(ip)) return send(res, 429, { error: '请求过于频繁，请稍后再试' });
    const body = await readBody(req);
    if (!validName(body.username)) return send(res, 400, { error: '用户名需为 1-20 位、不含空格' });
    if (!validPassword(body.password)) return send(res, 400, { error: '密码长度需为 4-128 位' });
    if (await findUserByName(body.username)) return send(res, 409, { error: '用户名已存在' });
    const hashed = await createPasswordHash(body.password);
    const user = await createUser(body.username, hashed.salt, hashed.hash);
    const token = await createSession(user.id);
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (authLimited(ip)) return send(res, 429, { error: '请求过于频繁，请稍后再试' });
    const body = await readBody(req);
    const user = await findUserByName(String(body.username || ''));
    const ok = user ? await verifyPassword(String(body.password || ''), user) : false;
    if (!user || !ok) return send(res, 401, { error: '用户名或密码不正确' });
    await touchLogin(user.id);
    const token = await createSession(user.id);
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
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
    const payload = await writeSave(user.id, data);
    return send(res, 200, { updatedAt: payload.updatedAt });
  }

  return send(res, 404, { error: '接口不存在' });
}

const server = http.createServer(function (req, res) {
  route(req, res).catch(function (error) {
    if (error && error.message === 'BAD_JSON') {
      return send(res, 400, { error: '请求内容不是合法 JSON' });
    }
    if (error && error.message === 'BODY_TOO_LARGE') {
      return send(res, 413, { error: '请求内容过大' });
    }
    if (error && (error.code === 'USER_EXISTS' || error.code === 'USER_LIMIT')) {
      return send(res, 409, { error: error.message });
    }
    console.error('[garden-api]', error);
    return send(res, 500, { error: '服务器内部错误' });
  });
});

server.listen(PORT, HOST, function () {
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : PORT;
  console.log('[garden-api] listening on http://' + HOST + ':' + actualPort);
  console.log('[garden-api] data dir: ' + (process.env.DATA_DIR || '(default ./data)'));
});
