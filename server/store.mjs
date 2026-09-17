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

async function atomicWrite(file, text) {
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(16).slice(2) + '.tmp';
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, file);
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

function savePath(userId) {
  return path.join(SAVES_DIR, userId + '.json');
}

export async function readSave(userId) {
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

export async function writeSave(userId, data) {
  return enqueue(async function () {
    await ensureDirs();
    const payload = { updatedAt: Date.now(), data: data };
    await atomicWrite(savePath(userId), JSON.stringify(payload));
    return payload;
  });
}

export async function loadSecret() {
  if (secretCache) return secretCache;
  await ensureDirs();
  try {
    secretCache = (await fs.readFile(SECRET_FILE, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    secretCache = '';
  }
  if (!secretCache) {
    secretCache = randomBytes(32).toString('hex');
    await atomicWrite(SECRET_FILE, secretCache);
  }
  return secretCache;
}
