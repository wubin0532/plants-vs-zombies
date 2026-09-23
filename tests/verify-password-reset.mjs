/**
 * 真机（Chromium）验证忘记密码重置：**保留进度**，不改 user.id。
 *
 * 走的是玩家真实路径：注册 → 攒进度 → 服务端重置密码 → 重启后端 → 浏览器用新密码登录。
 * 脚本自己拉起 garden-api（独立 DATA_DIR 与端口），不依赖仓库里已有的 data/。
 *
 * 用法：node tests/verify-password-reset.mjs
 * 需要 Playwright 浏览器；刻意不纳入 npm test（CI 不装浏览器）。
 */
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const KEY = "pvz-garden-save-v1::guest";
const OLD_PASSWORD = "old-password-1";
const NEW_PASSWORD = "new-password-2";
const failures = [];
const check = (ok, label, detail) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + label + (detail && !ok ? " — " + detail : ""));
  if (!ok) failures.push(label);
};

const dataDir = await mkdtemp(path.join(tmpdir(), "pvz-reset-"));
// 必须与 vite.config.ts 里 /api 的代理目标一致，浏览器请求才会打到本脚本拉起的后端。
const API_PORT = process.env.PVZ_API_PORT || "8787";
const base = "http://127.0.0.1:" + API_PORT;

function startServer() {
  const child = spawn(process.execPath, [path.join(process.cwd(), "server/index.mjs")], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dataDir, PORT: API_PORT, HOST: "127.0.0.1", MAX_USERS: "5", RATE_LIMIT_MAX: "50" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (/listening on/.test(buffer)) resolve(child);
    });
    child.stderr.on("data", (chunk) => process.stderr.write("[api] " + chunk));
    setTimeout(() => reject(new Error("garden-api 启动超时：" + buffer)), 8000);
  });
}
async function stopServer(child) {
  if (!child) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 3000);
  });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await context.addInitScript(() => {
  // 已看过教学，避免弹窗挡住登录入口。
  localStorage.setItem(
    "pvz-garden-save-v1::guest",
    JSON.stringify({
      version: 2, tutorialSeen: ["elements-transplant", "elements-arc", "elements-belt", "elements-bowling", "elements-whack", "elements-vases", "elements-boss"],
      unlocked: 6, completed: [1, 2, 3, 4, 5], coins: 300, coinsEarned: 300, coinsSpent: 0,
      sound: false, volume: 0.3, mix: { battle: 1, music: 0.25, environment: 0.3, ui: 0.65 },
      quality: "low", shake: false, stars: {}, lossStreak: {}, daily: { date: "", best: 0 },
      achievements: [], items: {}, itemsEarned: {}, itemsSpent: {}, seedSlots: 0, kills: 0,
      contrast: false, fontSize: "standard", options: {}, scores: [],
    }),
  );
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
const appUrl = process.env.PVZ_URL || "http://127.0.0.1:5199/";

/** 打开 设置 → 账号与存档 → 登录/注册 表单。 */
/** 用会话判断登录态（比在弹窗里找文字稳，也不受弹窗时序影响）。 */
async function sessionUser() {
  return page.evaluate(async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return null;
      const payload = await res.json();
      return payload?.user?.name ?? null;
    } catch {
      return null;
    }
  });
}

async function openAccountForm() {
  // 有些操作（例如退出登录）会关闭弹窗但留下遮罩，遮罩会挡住设置按钮。
  // 先按 Esc 关掉任何仍开着的弹窗，再确保遮罩已消失。
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  const veil = page.locator(".veil, .modal-veil, .overlay").first();
  if (await veil.count()) {
    await veil.click({ force: true, position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "账号与存档" }).first().click();
  await page.waitForTimeout(400);
  const toggle = page.getByRole("button", { name: /登录 \/ 注册/ });
  if (await toggle.count()) {
    await toggle.first().click();
    await page.waitForTimeout(500);
  }
}
async function fillAccountForm(username, password, mode) {
  if (mode) {
    const modeButton = page.getByRole("button", { name: mode, exact: true });
    if (await modeButton.count()) {
      await modeButton.first().click();
      await page.waitForTimeout(250);
    }
  }
  await page.locator('form.auth-form input[autocomplete="username"]').fill(username);
  await page.locator("form.auth-form input[type=password]").fill(password);
  await page.locator("form.auth-form button[type=submit]").click();
  await page.waitForTimeout(1800);
  return ((await page.locator("form.auth-form ~ p.notice, .notice").first().textContent().catch(() => "")) || "").trim();
}
async function closeModal() {
  const close = page.locator("button.close").first();
  if (await close.count()) { await close.click(); await page.waitForTimeout(300); }
}

async function submitAccount(username, password) {
  await page.getByRole("button", { name: /登录 \/ 注册/ }).first().click();
  await page.waitForTimeout(400);
  await page.locator('form.auth-form input[autocomplete="username"]').fill(username);
  await page.locator("form.auth-form input[type=password]").fill(password);
  await page.locator("form.auth-form button[type=submit]").click();
  await page.waitForTimeout(1500);
  const notice = await page.locator("form.auth-form ~ p.notice, .notice").first().textContent().catch(() => "");
  return (notice || "").trim();
}

let server = null;
try {
  server = await startServer();
  await page.goto(appUrl, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const username = "reset_" + Date.now().toString(36);
  console.log("1) 浏览器注册账号 " + username);
  await openAccountForm();
  const registerNotice = await fillAccountForm(username, OLD_PASSWORD, "注册");
  check(!/不正确|失败|错误/.test(registerNotice), "注册成功", registerNotice);
  await page.screenshot({ path: "output/fog-probe/reset-1-registered.png" });
  await closeModal();
  const registeredUser = await sessionUser();
  check(registeredUser === username, "注册后已建立会话", String(registeredUser));

  // 账号档里的进度要能体现"存档跟着账号走"。
  const userSave = JSON.parse(
    await readFile(path.join(dataDir, "users.json"), "utf8"),
  )[0];
  check(!!userSave?.id, "users.json 里有该账号", JSON.stringify(userSave));

  console.log("2) 服务端重置密码（保留 id 与存档）");
  await stopServer(server);
  server = null;
  const reset = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "server/reset-password.mjs"), username, "--password", NEW_PASSWORD],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATA_DIR: dataDir } },
  );
  check(reset.status === 0, "reset-password 执行成功", reset.stderr);
  const afterReset = JSON.parse(await readFile(path.join(dataDir, "users.json"), "utf8"))[0];
  check(afterReset.id === userSave.id, "user.id 未变（存档不会失联）", afterReset.id);
  check(/^v1\$/.test(afterReset.hash), "哈希为带参数格式");

  console.log("3) 重启后端后用浏览器登录");
  server = await startServer();
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  await openAccountForm();
  // Cookie 仍有效 → 刷新后本来就是登录态，这本身说明"账号还在、会话可用"。
  const stillLoggedIn = await sessionUser();
  check(stillLoggedIn === username, "重置密码后原会话仍有效（账号与存档没被动过）", String(stillLoggedIn));
  if (stillLoggedIn) {
    await page.getByRole("button", { name: "退出登录" }).first().click();
    await page.waitForTimeout(1500);
    check((await sessionUser()) === null, "退出登录后会话失效");
  }
  // 退出登录会关闭弹窗，且此时设置里才会重新出现"登录 / 注册"。
  await page.waitForTimeout(400);
  await openAccountForm();
  const staleNotice = await fillAccountForm(username, OLD_PASSWORD);
  console.log("    旧密码提示:", JSON.stringify(staleNotice));
  check(/不正确|失败|错误/.test(staleNotice), "旧密码被拒绝", staleNotice);
  const freshNotice = await fillAccountForm(username, NEW_PASSWORD);
  console.log("    新密码提示:", JSON.stringify(freshNotice));
  check(!/不正确|失败|错误/.test(freshNotice), "新密码登录成功", freshNotice);
  // 登录成功后表单会立刻消失（弹窗切到"已登录"视图），所以断言在关弹窗之后做。
  await page.screenshot({ path: "output/fog-probe/reset-2-logged-in.png" });
  await closeModal();
  await page.waitForTimeout(600);
  check((await sessionUser()) === username, "新密码登录后会话可用");

  check(errors.length === 0, "无 pageerror", errors.join(" | "));
} finally {
  await browser.close();
  await stopServer(server);
  await rm(dataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.log("\n验收失败：" + failures.join("；"));
  process.exit(1);
}
console.log("\n验收通过：重置密码保留账号与存档，旧密码失效、新密码在浏览器里可用。");
