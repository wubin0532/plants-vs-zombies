import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dataDir = '';
let child = null;
const port = 21000 + Math.floor(Math.random() * 5000);
const base = 'http://127.0.0.1:' + port;

function cookieFrom(response) {
  const headers = response.headers;
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const raw = list[0] || headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

function post(pathname, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return fetch(base + pathname, { method: 'POST', headers: headers, body: JSON.stringify(body) });
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'garden-api-'));
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, {
      DATA_DIR: dataDir,
      PORT: String(port),
      MAX_USERS: '2',
    }),
    stdio: 'ignore',
  });
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
});
