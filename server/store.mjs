import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// 数据目录：容器里由 DATA_DIR 指定，默认 ./data
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SAVES_DIR = path.join(DATA_DIR, 'saves');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

let usersCache = null;
let secretCache = null;
let chain = Promise.resolve();

export const dataDir = DATA_DIR;

async function ensureDirs() {
  await fs.mkdir(SAVES_DIR, { recursive: true });
}

/**
 * 原子写：临时文件 + fsync + rename + 目录 fsync。
 * 仅 rename 在掉电时可能丢失内容或留下 0 字节文件，NAS 场景需要 fsync。
 */
async function atomicWrite(file, text) {
  const tmp =
    file + '.' + process.pid + '.' + Math.random().toString(16).slice(2) + '.tmp';
  const handle = await fs.open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(function () {});
    throw error;
  }
  // 目录 fsync 确保 rename 本身落盘；部分平台/文件系统不支持，忽略即可。
  try {
    const dir = await fs.open(path.dirname(file), 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } catch (error) {
    /* directory fsync is best-effort */
  }
}

// 进程内串行化写入，避免同一文件并发覆盖
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(function () {}, function () {});
  return run;
}

export async function loadUsers() {
  if (usersCache) return usersCache;
  await ensureDirs();
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    usersCache = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    usersCache = [];
  }
  return usersCache;
}

export async function findUserByName(name) {
  const users = await loadUsers();
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  for (const user of users) {
    if (String(user.name).toLowerCase() === wanted) return user;
  }
  return null;
}

export async function findUserById(id) {
  const users = await loadUsers();
  for (const user of users) if (user.id === id) return user;
  return null;
}

export function maxUsers() {
  const value = Number(process.env.MAX_USERS || 5);
  return Number.isInteger(value) && value > 0 ? value : 5;
}

export async function createUser(name, salt, hash) {
  return enqueue(async function () {
    const users = await loadUsers();
    const wanted = name.trim().toLowerCase();
    for (const user of users) {
      if (String(user.name).toLowerCase() === wanted) {
        const error = new Error('用户名已存在');
        error.code = 'USER_EXISTS';
        throw error;
      }
    }
    if (users.length >= maxUsers()) {
      const error = new Error('账号数量已达上限');
      error.code = 'USER_LIMIT';
      throw error;
    }
    const user = {
      id: 'u_' + randomBytes(8).toString('hex'),
      name: name.trim(),
      salt: salt,
      hash: hash,
      // 会话版本：登出 / 改密时 +1，令所有旧 token 立即失效。
      sessionVersion: 0,
      createdAt: Date.now(),
      lastLoginAt: null,
    };
    users.push(user);
    usersCache = users;
    await atomicWrite(USERS_FILE, JSON.stringify(users, null, 2));
    return user;
  });
}

export async function touchLogin(id) {
  return enqueue(async function () {
    const users = await loadUsers();
    let found = null;
    for (const user of users) if (user.id === id) found = user;
    if (!found) return;
    found.lastLoginAt = Date.now();
    await atomicWrite(USERS_FILE, JSON.stringify(users, null, 2));
  });
}

/** 令某用户的所有已签发会话失效（登出、改密时调用）。 */
export async function bumpSessionVersion(id) {
  return enqueue(async function () {
    const users = await loadUsers();
    const found = users.find(function (user) {
      return user.id === id;
    });
    if (!found) return false;
    found.sessionVersion = (Number(found.sessionVersion) || 0) + 1;
    await atomicWrite(USERS_FILE, JSON.stringify(users, null, 2));
    return true;
  });
}

function savePath(userId) {
  return path.join(SAVES_DIR, userId + '.json');
}

async function readSaveFile(userId) {
  try {
    const raw = await fs.readFile(savePath(userId), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.data || typeof parsed.data !== 'object') return null;
    const updatedAt = Number(parsed.updatedAt);
    return { updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0, data: parsed.data };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readSave(userId) {
  return readSaveFile(userId);
}

/**
 * 带乐观并发的写入：
 * - baseUpdatedAt 是客户端上次见到的服务端修订号；
 * - 若服务端已有更新的修订号（其他设备写过），抛 SAVE_CONFLICT，由调用方决定重拉；
 * - updatedAt 取 max(now, existing+1)，保证严格单调，不再依赖客户端时钟。
 */
export async function writeSave(userId, data, baseUpdatedAt) {
  return enqueue(async function () {
    await ensureDirs();
    const existing = await readSaveFile(userId);
    if (
      existing &&
      baseUpdatedAt !== undefined &&
      baseUpdatedAt !== null &&
      existing.updatedAt > Number(baseUpdatedAt)
    ) {
      const error = new Error('SAVE_CONFLICT');
      error.code = 'SAVE_CONFLICT';
      error.current = existing;
      throw error;
    }
    const updatedAt = Math.max(Date.now(), (existing ? existing.updatedAt : 0) + 1);
    const payload = { updatedAt: updatedAt, data: data };
    await atomicWrite(savePath(userId), JSON.stringify(payload));
    return payload;
  });
}

export async function loadSecret() {
  if (secretCache) return secretCache;
  // 串行化 + 独占创建，避免冷启动并发生成两个不同的 secret.key。
  return enqueue(async function () {
    if (secretCache) return secretCache;
    await ensureDirs();
    try {
      secretCache = (await fs.readFile(SECRET_FILE, 'utf8')).trim();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      secretCache = '';
    }
    if (!secretCache) {
      const generated = randomBytes(32).toString('hex');
      let created = false;
      let handle = null;
      try {
        handle = await fs.open(SECRET_FILE, 'wx', 0o600);
        await handle.writeFile(generated);
        await handle.sync();
        created = true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      } finally {
        if (handle) await handle.close().catch(function () {});
      }
      if (created) {
        secretCache = generated;
      } else {
        // 另一个进程已抢先创建，读它的值。
        secretCache = (await fs.readFile(SECRET_FILE, 'utf8')).trim();
      }
    }
    return secretCache;
  });
}
