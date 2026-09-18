import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function cookieFrom(response) {
  const headers = response.headers;
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const raw = list[0] || headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

async function startServer(extraEnv) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'garden-api-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: '0', MAX_USERS: '2' }, extraEnv || {}),
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
    const response = await client.post('/api/auth/register', { username: alice, password: '1234' }, null, { 'X-Real-IP': ip(1) });
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
    const duplicate = await client.post('/api/auth/register', { username: alice, password: '1234' }, null, { 'X-Real-IP': ip(3) });
    expect(duplicate.status).toBe(409);
  });

  it('登出后旧 Cookie 立即失效（会话版本撤销）', async () => {
    const login = await client.post('/api/auth/login', { username: alice, password: '1234' }, null, { 'X-Real-IP': ip(4) });
    const cookie = cookieFrom(login);
    expect((await client.me(cookie)).status).toBe(200);
    const out = await client.post('/api/auth/logout', {}, cookie, { 'X-Real-IP': ip(4) });
    expect(out.status).toBe(200);
    // 旧 token 仍被浏览器持有，但服务端已作废
    expect((await client.me(cookie)).status).toBe(401);
  });

  it('存档按用户隔离', async () => {
    const loginA = await client.post('/api/auth/login', { username: alice, password: '1234' }, null, { 'X-Real-IP': ip(5) });
    const cookieA = cookieFrom(loginA);
    const put = await client.putSave(cookieA, { version: 2, unlocked: 7 });
    expect(put.status).toBe(200);

    const readA = await fetch(main.base + '/api/save', { headers: { Cookie: cookieA } });
    const saveA = await readA.json();
    expect(saveA.save.data.unlocked).toBe(7);

    const registerB = await client.post('/api/auth/register', { username: bob, password: '5678' }, null, { 'X-Real-IP': ip(6) });
    const cookieB = cookieFrom(registerB);
    const readB = await fetch(main.base + '/api/save', { headers: { Cookie: cookieB } });
    const saveB = await readB.json();
    expect(saveB.save).toBeNull();
  });

  it('超过 MAX_USERS 后拒绝注册', async () => {
    const third = await client.post('/api/auth/register', { username: 'carol_' + suffix, password: '1234' }, null, { 'X-Real-IP': ip(7) });
    expect(third.status).toBe(409);
  });

  it('乐观并发：过期 baseUpdatedAt 返回 409 与当前存档，修订号严格单调', async () => {
    // bob 在本套件中尚无存档，baseUpdatedAt=0 是有效的初始修订号
    const login = await client.post('/api/auth/login', { username: bob, password: '5678' }, null, { 'X-Real-IP': ip(8) });
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

  it('拒绝跨站写请求（Origin 与 Host 不一致）', async () => {
    const response = await fetch(main.base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ username: alice, password: '1234' }),
    });
    expect(response.status).toBe(403);
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

  it('PUT /api/save 有按用户的宽松限流', async () => {
    // 上一个测试打满了 127.0.0.1 的登录额度，等窗口过期后再注册
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    const suffix = Date.now().toString(36);
    const register = await c.post('/api/auth/register', { username: 'dave_' + suffix, password: '1234' });
    expect(register.status).toBe(200);
    const cookie = cookieFrom(register);

    const writes = [];
    for (let i = 0; i < 4; i++) writes.push(c.putSave(cookie, { version: 2, unlocked: 2 }));
    const statuses = (await Promise.all(writes)).map(function (r) { return r.status; });
    expect(statuses.filter(function (s) { return s === 200; })).toHaveLength(3);
    expect(statuses.filter(function (s) { return s === 429; })).toHaveLength(1);
  });
});
