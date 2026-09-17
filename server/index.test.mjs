import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dataDir = '';
let child = null;
let base = '';

function cookieFrom(response) {
  const headers = response.headers;
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const raw = list[0] || headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

function post(pathname, body, cookie, extraHeaders) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
  if (cookie) headers.Cookie = cookie;
  return fetch(base + pathname, { method: 'POST', headers: headers, body: JSON.stringify(body) });
}

function loginFrom(ip, viaRealIp) {
  const headers = viaRealIp ? { 'X-Real-IP': ip } : { 'X-Forwarded-For': ip };
  return post('/api/auth/login', { username: 'nobody', password: 'nope' }, null, headers);
}

function putSave(cookie) {
  return fetch(base + '/api/save', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ data: { version: 2, unlocked: 1 } }),
  });
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'garden-api-'));
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, {
      DATA_DIR: dataDir,
      PORT: '0',
      MAX_USERS: '2',
      // 缩短限流窗口以便测试“过期后恢复”；存档限额调小以便快速触发
      RATE_LIMIT_WINDOW_MS: '300',
      SAVE_RATE_LIMIT_MAX: '3',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 监听 0 端口，从启动日志解析系统实际分配的端口，避免随机端口碰撞
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
  base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch (error) {
      // 服务还没起来
    }
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  throw new Error('garden-api 未能启动');
});

afterAll(async () => {
  if (child) child.kill();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('garden-api', () => {
  const suffix = Date.now().toString(36);
  const alice = 'alice_' + suffix;
  const bob = 'bob_' + suffix;

  it('注册后可读取当前用户，未登录返回 401', async () => {
    const response = await post('/api/auth/register', { username: alice, password: '1234' });
    expect(response.status).toBe(200);
    const cookie = cookieFrom(response);
    expect(cookie).toContain('pvz_session=');

    const me = await fetch(base + '/api/me', { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    const payload = await me.json();
    expect(payload.user.name).toBe(alice);

    const anonymous = await fetch(base + '/api/me');
    expect(anonymous.status).toBe(401);
  });

  it('密码错误与重复用户名被拒绝', async () => {
    const wrong = await post('/api/auth/login', { username: alice, password: 'nope' });
    expect(wrong.status).toBe(401);
    const duplicate = await post('/api/auth/register', { username: alice, password: '1234' });
    expect(duplicate.status).toBe(409);
  });

  it('存档按用户隔离', async () => {
    const loginA = await post('/api/auth/login', { username: alice, password: '1234' });
    const cookieA = cookieFrom(loginA);
    const put = await fetch(base + '/api/save', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ data: { version: 2, unlocked: 7 } }),
    });
    expect(put.status).toBe(200);

    const readA = await fetch(base + '/api/save', { headers: { Cookie: cookieA } });
    const saveA = await readA.json();
    expect(saveA.save.data.unlocked).toBe(7);

    const registerB = await post('/api/auth/register', { username: bob, password: '5678' });
    const cookieB = cookieFrom(registerB);
    const readB = await fetch(base + '/api/save', { headers: { Cookie: cookieB } });
    const saveB = await readB.json();
    expect(saveB.save).toBeNull();
  });

  it('超过 MAX_USERS 后拒绝注册', async () => {
    const third = await post('/api/auth/register', { username: 'carol_' + suffix, password: '1234' });
    expect(third.status).toBe(409);
  });

  it('限流按 X-Forwarded-For 首跳计数，超限返回 429，不影响其它 IP', async () => {
    // 打满 198.51.100.1 的额度（窗口内 20 次，第 21 次开始 429）
    const hammer = [];
    for (let i = 0; i < 21; i++) hammer.push(loginFrom('198.51.100.1'));
    const statuses = (await Promise.all(hammer)).map(function (r) { return r.status; });
    expect(statuses.filter(function (s) { return s === 429; })).toHaveLength(1);
    expect(statuses.filter(function (s) { return s === 401; })).toHaveLength(20);

    // 其它客户端 IP 不受牵连（反代后每个玩家有自己的额度）
    const other = await loginFrom('198.51.100.2');
    expect(other.status).toBe(401);
  });

  it('多跳 X-Forwarded-For 取首跳，X-Real-IP 作为回退', async () => {
    // 同一突发里混用多跳与单跳头：22 个请求都计入首跳 198.51.100.5，产生 2 个 429
    const burst = [];
    for (let i = 0; i < 21; i++) burst.push(loginFrom('198.51.100.5, 10.0.0.2'));
    burst.push(loginFrom('198.51.100.5'));
    const statuses = (await Promise.all(burst)).map(function (r) { return r.status; });
    expect(statuses.filter(function (s) { return s === 429; })).toHaveLength(2);
    expect(statuses.filter(function (s) { return s === 401; })).toHaveLength(20);

    // 仅有 X-Real-IP 时按 X-Real-IP 计数
    const realIpBurst = [];
    for (let i = 0; i < 21; i++) realIpBurst.push(loginFrom('198.51.100.3', true));
    const realIpStatuses = (await Promise.all(realIpBurst)).map(function (r) { return r.status; });
    expect(realIpStatuses.filter(function (s) { return s === 429; })).toHaveLength(1);
  });

  it('限流窗口过期后自动恢复', async () => {
    const hammer = [];
    for (let i = 0; i < 21; i++) hammer.push(loginFrom('198.51.100.10'));
    const statuses = (await Promise.all(hammer)).map(function (r) { return r.status; });
    expect(statuses).toContain(429);

    // RATE_LIMIT_WINDOW_MS=300，等窗口过期后同一 IP 恢复计数
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    const after = await loginFrom('198.51.100.10');
    expect(after.status).toBe(401);
  });

  it('PUT /api/save 有按用户的宽松限流', async () => {
    const loginA = await post('/api/auth/login', { username: alice, password: '1234' });
    expect(loginA.status).toBe(200);
    const cookieA = cookieFrom(loginA);

    // SAVE_RATE_LIMIT_MAX=3，第 4 次写入被 429
    const writes = [];
    for (let i = 0; i < 4; i++) writes.push(putSave(cookieA));
    const statuses = (await Promise.all(writes)).map(function (r) { return r.status; });
    expect(statuses.filter(function (s) { return s === 200; })).toHaveLength(3);
    expect(statuses.filter(function (s) { return s === 429; })).toHaveLength(1);
  });
});
