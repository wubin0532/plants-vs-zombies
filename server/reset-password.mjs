#!/usr/bin/env node
/**
 * 重置某个账号的登录密码（保留该账号的云存档）。
 *
 * 与"删账号重注册"的区别：**只换 salt/hash，不动 user.id**，因此
 * `saves/<id>.json` 依旧指向同一个账号，进度不丢。
 *
 * 用法：
 *   DATA_DIR=/data/garden node server/reset-password.mjs <用户名>
 *   DATA_DIR=/data/garden node server/reset-password.mjs <用户名> --password '新密码'
 *   DATA_DIR=/data/garden node server/reset-password.mjs --list
 *
 * 注意：运行中的服务会把 users.json 缓存在内存里，改完必须重启容器才生效。
 * 容器里执行示例：
 *   sudo docker exec -it garden-api node /app/server/reset-password.mjs <用户名>
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createPasswordHash } from './auth.mjs';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

/** 与服务端 validPassword 保持一致。 */
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function parseArgs(argv) {
  const out = { username: '', password: '', list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') out.list = true;
    else if (arg === '--password' || arg === '-p') out.password = argv[++i] || '';
    else if (!out.username) out.username = arg;
  }
  return out;
}

function fail(message) {
  console.error('[reset-password] ' + message);
  process.exit(1);
}

/** 原子写（与 server/store.mjs 同一套做法，避免掉电留下半截文件）。 */
async function atomicWrite(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  const handle = await fs.open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
}

async function readUsers() {
  let raw;
  try {
    raw = await fs.readFile(USERS_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') fail('找不到 ' + USERS_FILE + '（DATA_DIR 是否正确？）');
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(USERS_FILE + ' 不是合法 JSON。先修好账号库再重置（服务端会把它留档为 .corrupt-*）。');
  }
  if (!Array.isArray(parsed)) fail(USERS_FILE + ' 的内容不是用户数组');
  return parsed;
}

function promptHidden(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    const onData = (char) => {
      // 隐藏输入：把回显的字符抹掉，只保留提示语。
      if (String(char).includes('\n') || String(char).includes('\r')) return;
      process.stdout.write('\r\x1b[K' + question);
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      process.stdin.off('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const users = await readUsers();

  if (args.list || !args.username) {
    if (!users.length) {
      console.log('账号库为空（' + USERS_FILE + '）');
      return;
    }
    console.log('共 ' + users.length + ' 个账号（' + USERS_FILE + '）：');
    for (const user of users) {
      const save = path.join(DATA_DIR, 'saves', user.id + '.json');
      let hasSave = false;
      try {
        await fs.access(save);
        hasSave = true;
      } catch {
        /* 没有存档也正常 */
      }
      const last = user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '从未登录';
      console.log('  - ' + user.name + '  id=' + user.id + '  存档=' + (hasSave ? '有' : '无') + '  上次登录=' + last);
    }
    if (!args.username && !args.list) {
      console.log('\n提示：加用户名即可重置密码，例如 node server/reset-password.mjs <用户名>');
    }
    return;
  }

  const wanted = args.username.trim().toLowerCase();
  const user = users.find((u) => String(u.name || '').trim().toLowerCase() === wanted);
  if (!user) {
    console.error('[reset-password] 没有名为 "' + args.username + '" 的账号。现有账号：');
    for (const u of users) console.error('  - ' + u.name);
    process.exit(1);
  }

  let password = args.password;
  if (!password) {
    password = await promptHidden('为账号 "' + user.name + '" 输入新密码（不回显）：');
    const again = await promptHidden('再输入一次确认：');
    if (password !== again) fail('两次输入不一致，未做任何修改');
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    fail('密码长度需为 ' + MIN_PASSWORD + '-' + MAX_PASSWORD + ' 位（与服务端校验一致）');
  }

  const hashed = await createPasswordHash(password);
  user.salt = hashed.salt;
  user.hash = hashed.hash;
  await atomicWrite(USERS_FILE, JSON.stringify(users, null, 2));

  const save = path.join(DATA_DIR, 'saves', user.id + '.json');
  let hasSave = false;
  try {
    await fs.access(save);
    hasSave = true;
  } catch {
    /* ignore */
  }

  console.log('[reset-password] 已重置 "' + user.name + '" 的密码。');
  console.log('  user.id 未变：' + user.id);
  console.log('  云存档：' + (hasSave ? '保留（' + save + '）' : '该账号暂无存档'));
  console.log('  密码哈希：已升级为当前参数（v1$N$r$p$hash）');
  console.log('\n下一步必须重启后端，否则运行中的服务仍用内存里的旧哈希：');
  console.log('  sudo docker restart garden-api');
}

main().catch((error) => {
  console.error('[reset-password] 失败：' + (error && error.message ? error.message : error));
  process.exit(1);
});
