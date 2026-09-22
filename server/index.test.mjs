import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function cookieFrom(response) {
  const headers = response.headers;
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const raw = list[0] || headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

async function startServer(extraEnv, options) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'garden-api-'));
  // 显式传 undefined 视为"不注入这个变量"，好让 .env 里的值成为唯一来源。
  const env = Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: '0', MAX_USERS: '2' });
  for (const key of Object.keys(extraEnv || {})) {
    if (extraEnv[key] === undefined) delete env[key];
    else env[key] = extraEnv[key];
  }
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server/index.mjs')], {
    cwd: (options && options.cwd) || process.cwd(),
    env: env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise(function (resolve, reject) {
    let buffer = '';
    const timer = setTimeout(function () {
      reject(new Error('garden-api 未能启动: ' + buffer));
    }, 10000);
    child.stdout.on('data', function (chunk) {
      buffer += chunk;
      const match = buffer.match(/listening on http:\/\/\S+:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('exit', function (code) {
      clearTimeout(timer);
      reject(new Error('garden-api 提前退出 (code=' + code + '): ' + buffer));
    });
  });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) break;
    } catch (error) {
      /* not up yet */
    }
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  return {
    base: base,
    dataDir: dataDir,
    child: child,
    stop: async function () {
      child.kill();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

function makeClient(base) {
  function post(pathname, body, cookie, extraHeaders) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    if (cookie) headers.Cookie = cookie;
    return fetch(base + pathname, { method: 'POST', headers: headers, body: JSON.stringify(body) });
  }
  function putSave(cookie, data, baseUpdatedAt) {
    const body = baseUpdatedAt === undefined ? { data: data } : { data: data, baseUpdatedAt: baseUpdatedAt };
    return fetch(base + '/api/save', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
  }
  function me(cookie) {
    return fetch(base + '/api/me', { headers: cookie ? { Cookie: cookie } : {} });
  }
  return { post: post, putSave: putSave, me: me };
}

let main;
let client;

beforeAll(async () => {
  main = await startServer({
    TRUST_PROXY: '1',
    RATE_LIMIT_WINDOW_MS: '300',
    RATE_LIMIT_MAX: '20',
    SAVE_RATE_LIMIT_MAX: '100',
    ALLOWED_ORIGINS: 'https://game.wubin.ink:8443,http://127.0.0.1:5888',
  });
  client = makeClient(main.base);
});

afterAll(async () => {
  if (main) await main.stop();
});

describe('garden-api · 账号与会话', () => {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const alice = 'alice_' + suffix;
  const bob = 'bob_' + suffix;
  const ip = function (n) { return '198.51.100.' + n; };

  it('注册后可读取当前用户，未登录返回 401', async () => {
    const response = await client.post('/api/auth/register', { username: alice, password: '12345678' }, null, { 'X-Real-IP': ip(1) });
    expect(response.status).toBe(200);
    const cookie = cookieFrom(response);
    expect(cookie).toContain('pvz_session=');

    const me = await client.me(cookie);
    expect(me.status).toBe(200);
    const payload = await me.json();
    expect(payload.user.name).toBe(alice);

    const anonymous = await client.me(null);
    expect(anonymous.status).toBe(401);
  });

  it('密码错误与重复用户名被拒绝', async () => {
    const wrong = await client.post('/api/auth/login', { username: alice, password: 'nope' }, null, { 'X-Real-IP': ip(2) });
    expect(wrong.status).toBe(401);
    const duplicate = await client.post('/api/auth/register', { username: alice, password: '12345678' }, null, { 'X-Real-IP': ip(3) });
    expect(duplicate.status).toBe(409);
  });

  it('登出后旧 Cookie 立即失效（会话版本撤销）', async () => {
    const login = await client.post('/api/auth/login', { username: alice, password: '12345678' }, null, { 'X-Real-IP': ip(4) });
    const cookie = cookieFrom(login);
    expect((await client.me(cookie)).status).toBe(200);
    const out = await client.post('/api/auth/logout', {}, cookie, { 'X-Real-IP': ip(4) });
    expect(out.status).toBe(200);
    // 旧 token 仍被浏览器持有，但服务端已作废
    expect((await client.me(cookie)).status).toBe(401);
  });

  it('存档按用户隔离', async () => {
    const loginA = await client.post('/api/auth/login', { username: alice, password: '12345678' }, null, { 'X-Real-IP': ip(5) });
    const cookieA = cookieFrom(loginA);
    const put = await client.putSave(cookieA, { version: 2, unlocked: 7 });
    expect(put.status).toBe(200);

    const readA = await fetch(main.base + '/api/save', { headers: { Cookie: cookieA } });
    const saveA = await readA.json();
    expect(saveA.save.data.unlocked).toBe(7);

    const registerB = await client.post('/api/auth/register', { username: bob, password: '56781234' }, null, { 'X-Real-IP': ip(6) });
    const cookieB = cookieFrom(registerB);
    const readB = await fetch(main.base + '/api/save', { headers: { Cookie: cookieB } });
    const saveB = await readB.json();
    expect(saveB.save).toBeNull();
  });

  it('超过 MAX_USERS 后拒绝注册', async () => {
    const third = await client.post('/api/auth/register', { username: 'carol_' + suffix, password: '12345678' }, null, { 'X-Real-IP': ip(7) });
    expect(third.status).toBe(409);
  });

  it('乐观并发：过期 baseUpdatedAt 返回 409 与当前存档，修订号严格单调', async () => {
    // bob 在本套件中尚无存档，baseUpdatedAt=0 是有效的初始修订号
    const login = await client.post('/api/auth/login', { username: bob, password: '56781234' }, null, { 'X-Real-IP': ip(8) });
    const cookie = cookieFrom(login);
    const first = await client.putSave(cookie, { version: 2, unlocked: 8 }, 0);
    expect(first.status).toBe(200);
    const rev = (await first.json()).updatedAt;

    // 模拟别的设备已经写过：用更旧的修订号提交被拒
    const stale = await client.putSave(cookie, { version: 2, unlocked: 9 }, rev - 1);
    expect(stale.status).toBe(409);
    const conflict = await stale.json();
    expect(conflict.save.updatedAt).toBe(rev);
    expect(conflict.save.data.unlocked).toBe(8);

    // 用最新修订号提交成功，且新修订号更大
    const ok = await client.putSave(cookie, { version: 2, unlocked: 9 }, rev);
    expect(ok.status).toBe(200);
    expect((await ok.json()).updatedAt).toBeGreaterThan(rev);
  });

  it('两个账号的存档双向隔离：文件与接口都只看到自己的标记', async () => {
    // 该用例放在乐观并发之后：它对 bob 存档内容的后续无依赖，且确保两个账号都已存在。
    const loginA = await client.post('/api/auth/login', { username: alice, password: '12345678' }, null, { 'X-Real-IP': ip(9) });
    const cookieA = cookieFrom(loginA);
    const loginB = await client.post('/api/auth/login', { username: bob, password: '56781234' }, null, { 'X-Real-IP': ip(10) });
    const cookieB = cookieFrom(loginB);

    // 各自写一份带可识别标记的档
    expect((await client.putSave(cookieA, { version: 2, unlocked: 11, mark: 'A' })).status).toBe(200);
    expect((await client.putSave(cookieB, { version: 2, unlocked: 12, mark: 'B' })).status).toBe(200);

    // 各读各的：只看到自己的标记
    const saveA = await (await fetch(main.base + '/api/save', { headers: { Cookie: cookieA } })).json();
    const saveB = await (await fetch(main.base + '/api/save', { headers: { Cookie: cookieB } })).json();
    expect(saveA.save.data).toMatchObject({ unlocked: 11, mark: 'A' });
    expect(saveB.save.data).toMatchObject({ unlocked: 12, mark: 'B' });

    // A 再写一次，B 的档不受任何影响
    expect((await client.putSave(cookieA, { version: 2, unlocked: 21, mark: 'A2' })).status).toBe(200);
    const saveB2 = await (await fetch(main.base + '/api/save', { headers: { Cookie: cookieB } })).json();
    expect(saveB2.save.data).toMatchObject({ unlocked: 12, mark: 'B' });

    // 未登录读档仍是 401
    expect((await fetch(main.base + '/api/save')).status).toBe(401);

    // 落盘层面：恰好两个用户档，且各含自己的标记，没有互相覆盖
    const savesDir = path.join(main.dataDir, 'saves');
    const files = (await readdir(savesDir)).sort();
    expect(files).toHaveLength(2);
    const marks = (await Promise.all(files.map(async function (file) {
      const parsed = JSON.parse(await readFile(path.join(savesDir, file), 'utf8'));
      return parsed.data.mark;
    }))).sort();
    expect(marks).toEqual(['A2', 'B']);
  });

  it('拒绝跨站写请求（Origin 主机名不同）', async () => {
    const response = await fetch(main.base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ username: alice, password: '12345678' }),
    });
    expect(response.status).toBe(403);
  });

  it('ALLOWED_ORIGINS 内的来源放行（公网域名 / 反代丢端口）', async () => {
    for (const origin of ['https://game.wubin.ink:8443', 'http://127.0.0.1:5888']) {
      const response = await fetch(main.base + '/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'X-Real-IP': '198.51.100.250',
        },
        body: JSON.stringify({ username: 'nobody', password: 'nope' }),
      });
      expect(response.status, origin).toBe(401);
    }
  });

  it('TRUST_PROXY=1 时按 X-Real-IP 分桶，超限返回 429 且不影响其它 IP', async () => {
    const hammer = [];
    for (let i = 0; i < 21; i++) {
      hammer.push(client.post('/api/auth/login', { username: 'nobody', password: 'nope' }, null, { 'X-Real-IP': '203.0.113.9' }));
    }
    const statuses = (await Promise.all(hammer)).map(function (r) { return r.status; });
    expect(statuses.filter(function (s) { return s === 429; })).toHaveLength(1);
    expect(statuses.filter(function (s) { return s === 401; })).toHaveLength(20);

    const other = await client.post('/api/auth/login', { username: 'nobody', password: 'nope' }, null, { 'X-Real-IP': '203.0.113.10' });
    expect(other.status).toBe(401);
  });
});

describe('garden-api · 限流与保存限额（不信任代理）', () => {
  let server;
  let c;
  beforeAll(async () => {
    server = await startServer({
      RATE_LIMIT_WINDOW_MS: '300',
      RATE_LIMIT_MAX: '20',
      SAVE_RATE_LIMIT_MAX: '3',
    });
    c = makeClient(server.base);
  });
  afterAll(async () => {
    if (server) await server.stop();
  });

  it('伪造的 X-Forwarded-For 不能分桶（回退到 TCP 来源地址）', async () => {
    const burst = [];
    for (let i = 0; i < 21; i++) {
      burst.push(c.post('/api/auth/login', { username: 'nobody', password: 'nope' }, null, { 'X-Forwarded-For': '198.51.100.' + i }));
    }
    const statuses = (await Promise.all(burst)).map(function (r) { return r.status; });
    // 全部来自 127.0.0.1，共用一个桶：20 次 401 + 1 次 429
    expect(statuses.filter(function (s) { return s === 429; })).toHaveLength(1);
    expect(statuses.filter(function (s) { return s === 401; })).toHaveLength(20);
  });

  it('未配置 ALLOWED_ORIGINS 时不拒绝任何 Origin（避免反代误伤）', async () => {
    // 上一个测试打满了 127.0.0.1 的登录额度，等窗口过期
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    const response = await c.post('/api/auth/login', { username: 'nobody', password: 'nope' }, null, {
      Origin: 'https://evil.example',
    });
    expect(response.status).toBe(401);
  });

  it('PUT /api/save 有按用户的宽松限流', async () => {
    // 上一个测试打满了 127.0.0.1 的登录额度，等窗口过期后再注册
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    const suffix = Date.now().toString(36);
    const register = await c.post('/api/auth/register', { username: 'dave_' + suffix, password: '12345678' });
    expect(register.status).toBe(200);
    const cookie = cookieFrom(register);

    const writes = [];
    for (let i = 0; i < 4; i++) writes.push(c.putSave(cookie, { version: 2, unlocked: 2 }));
    const statuses = (await Promise.all(writes)).map(function (r) { return r.status; });
    expect(statuses.filter(function (s) { return s === 200; })).toHaveLength(3);
    expect(statuses.filter(function (s) { return s === 429; })).toHaveLength(1);
  });
});

describe('garden-api · 配置与密码下限', () => {
  it('密码短于 8 位被拒绝，8 位可用', async () => {
    const server = await startServer({ RATE_LIMIT_MAX: '20' });
    try {
      const c = makeClient(server.base);
      const suffix = Date.now().toString(36);
      const short = await c.post('/api/auth/register', { username: 'short_' + suffix, password: '1234' });
      expect(short.status, '4 位密码必须被拒绝').toBe(400);
      const seven = await c.post('/api/auth/register', { username: 'seven_' + suffix, password: '1234567' });
      expect(seven.status, '7 位密码必须被拒绝').toBe(400);
      const ok = await c.post('/api/auth/register', { username: 'ok_' + suffix, password: '12345678' });
      expect(ok.status).toBe(200);
      // 报错文案必须与实际下限一致（此前文案说 8 位、实现只要求 4 位）。
      expect((await short.json()).error).toContain('8-128');
    } finally {
      await server.stop();
    }
  });

  it('非法数值环境变量回退默认值，不会静默关闭限流', async () => {
    const server = await startServer({
      RATE_LIMIT_WINDOW_MS: '300',
      RATE_LIMIT_MAX: 'abc',
      SAVE_RATE_LIMIT_MAX: '0',
    });
    try {
      const c = makeClient(server.base);
      // 限流上限回退为 20：前 20 次登录尝试应该是 401（凭据错）而不是 429。
      const statuses = [];
      for (let i = 0; i < 3; i++) {
        const r = await c.post('/api/auth/login', { username: 'nobody', password: 'nope' });
        statuses.push(r.status);
      }
      expect(statuses.every(function (s) { return s === 401; })).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('工作目录下的 .env 会被加载', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'garden-env-'));
    try {
      await writeFile(path.join(dir, '.env'), 'RATE_LIMIT_MAX=3\n');
      const server = await startServer({ RATE_LIMIT_MAX: undefined, RATE_LIMIT_WINDOW_MS: '60000' }, { cwd: dir });
      try {
        const c = makeClient(server.base);
        // RATE_LIMIT_MAX 只由 .env 提供（值为 3）：第 4 次尝试必须 429。
        const statuses = [];
        for (let i = 0; i < 4; i++) {
          const r = await c.post('/api/auth/login', { username: 'nobody', password: 'nope' });
          statuses.push(r.status);
        }
        expect(statuses.slice(0, 3).every(function (s) { return s === 401; })).toBe(true);
        expect(statuses[3], '.env 里的 RATE_LIMIT_MAX 必须生效').toBe(429);
      } finally {
        await server.stop();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('garden-api · 来源地址与数据自愈', () => {
  it('X-Real-IP 不是合法 IP 时回退到 TCP 来源地址', async () => {
    // 服务端默认按 TCP 来源计数；伪造的 X-Real-IP 只能制造同一个桶，
    // 不能靠换字符串拿到新额度。
    const server = await startServer({
      TRUST_PROXY: '1',
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX: '2',
    });
    try {
      const c = makeClient(server.base);
      const statuses = [];
      for (let i = 0; i < 3; i++) {
        const r = await c.post(
          '/api/auth/login',
          { username: 'nobody', password: 'nope' },
          null,
          { 'X-Real-IP': 'not-an-ip-' + i },
        );
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 2).every(function (s) { return s === 401; })).toBe(true);
      expect(statuses[2], '非法 X-Real-IP 不应各自分桶').toBe(429);
    } finally {
      await server.stop();
    }
  });

  it('同一来源的 IPv4-mapped 写法归入同一个限流桶', async () => {
    const server = await startServer({
      TRUST_PROXY: '1',
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX: '2',
    });
    try {
      const c = makeClient(server.base);
      const statuses = [];
      for (const ipHeader of ['1.2.3.4', '::ffff:1.2.3.4', '[1.2.3.4]:1234']) {
        const r = await c.post(
          '/api/auth/login',
          { username: 'nobody', password: 'nope' },
          null,
          { 'X-Real-IP': ipHeader },
        );
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 2).every(function (s) { return s === 401; })).toBe(true);
      expect(statuses[2], '归一化后应共用同一个桶').toBe(429);
    } finally {
      await server.stop();
    }
  });

  it('users.json 损坏时留档并自愈，而不是永久 500', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'garden-broken-'));
    try {
      await writeFile(path.join(dataDir, 'users.json'), '{broken');
      const server = await startServer({ DATA_DIR: dataDir });
      try {
        const health = await (await fetch(server.base + '/api/health')).json();
        expect(health.ok).toBe(true);
        expect(health.users).toBe(0);
        const names = await readdir(dataDir);
        expect(names.some(function (n) { return n.indexOf('users.json.corrupt-') === 0; })).toBe(true);
      } finally {
        await server.stop();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('旧参数的裸哈希仍可登录，并在登录后升级为带参数的格式', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'garden-legacy-'));
    const { scrypt } = await import('node:crypto');
    const { promisify } = await import('node:util');
    const scryptAsync = promisify(scrypt);
    const name = 'legacy_' + Date.now().toString(36);
    const password = 'legacy-password';
    const salt = 'a'.repeat(32);
    // 复刻升级前的存储格式：裸 hex、N 为 Node 默认的 16384。
    const derived = await scryptAsync(password, salt, 64);
    const users = [
      {
        id: 'u_' + 'b'.repeat(16),
        name: name,
        salt: salt,
        hash: derived.toString('hex'),
        sessionVersion: 0,
        createdAt: Date.now(),
        lastLoginAt: null,
      },
    ];
    try {
      await writeFile(path.join(dataDir, 'users.json'), JSON.stringify(users, null, 2));
      const server = await startServer({ DATA_DIR: dataDir });
      try {
        const c = makeClient(server.base);
        const login = await c.post('/api/auth/login', { username: name, password: password });
        expect(login.status, '旧哈希必须仍可登录').toBe(200);
        const stored = JSON.parse(await readFile(path.join(dataDir, 'users.json'), 'utf8'));
        expect(stored[0].hash, '登录后应升级为 v1$N$r$p$hash').toMatch(/^v1\$/);
        expect(stored[0].hash.split('$')[1]).toBe(String(1 << 17));
        // 升级后仍可用同一口令登录（新参数校验通过）。
        const again = await c.post('/api/auth/login', { username: name, password: password });
        expect(again.status).toBe(200);
      } finally {
        await server.stop();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('写请求缺少 JSON Content-Type 时拒绝（415）', async () => {
    const server = await startServer({ MAX_USERS: '5' });
    try {
      const response = await fetch(server.base + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ username: 'nobody', password: 'nope' }),
      });
      expect(response.status).toBe(415);
    } finally {
      await server.stop();
    }
  });
});

describe('garden-api · 地址归一化', () => {
  it('剥掉 IPv4-mapped、端口、方括号与 zone id，非法值返回 null', async () => {
    const { normalizeIp } = await import('./index.mjs');
    expect(normalizeIp('1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('[1.2.3.4]:1234')).toBe('1.2.3.4');
    expect(normalizeIp('1.2.3.4:56')).toBe('1.2.3.4');
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIp('not-an-ip')).toBeNull();
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});

describe('garden-api · 限流桶容量上限', () => {
  it('触顶时先清过期项；仍然满则拒绝新键', async () => {
    const { makeRateLimiter } = await import('./index.mjs');
    const limited = makeRateLimiter(1, 2, 60000);
    expect(limited('a')).toBe(false);
    expect(limited('b')).toBe(false);
    // 第三次尝试：上限为 1 的窗口内，重复键会被限流而不是被当成新键。
    expect(limited('a')).toBe(true);
    // 新键触顶 → 拒绝（而不是让 Map 无上限增长）。
    expect(limited('c')).toBe(true);
  });

  it('触顶但存在过期条目时，先清理再接纳新键', async () => {
    const { makeRateLimiter } = await import('./index.mjs');
    const limited = makeRateLimiter(5, 1, 20);
    expect(limited('old')).toBe(false);
    await new Promise(function (resolve) { setTimeout(resolve, 40); });
    // old 已过期：新键应被接纳，而不是因为 Map 满被拒。
    expect(limited('fresh')).toBe(false);
    expect(limited('fresh')).toBe(false);
  });
});
