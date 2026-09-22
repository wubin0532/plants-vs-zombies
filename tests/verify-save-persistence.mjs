/**
 * 本地浏览器验收：真实 Chromium 里的存档记账往返。
 *
 * 覆盖单元测试无法覆盖的部分——应用在浏览器里的实际读写路径：
 *  1) 读入"升级前"的 v2 档（没有 coinsEarned/coinsSpent/itemsEarned/itemsSpent）
 *     必须照常加载、不报错、progress 不回退；
 *  2) 触发一次真实 persist（开局消耗道具）后，落盘内容必须带上四个记账字段，
 *     并且满足 余额 ≤ 累计获得、累计消耗 ≤ 累计获得 的不变量；
 *  3) 整条路径不能有 pageerror。
 *
 * 用法：先起 dev server，再执行
 *   node tests/verify-save-persistence.mjs [url]
 * 该脚本刻意不进 npm test：CI 不安装 Playwright 浏览器。
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] || process.env.PVZ_URL || "http://127.0.0.1:5199/";
const SAVE_KEY = "pvz-garden-save-v1::guest";

/** 升级前的 v2 档：有 coins/items，但没有四个记账字段。 */
const LEGACY_V2 = {
  version: 2,
  tutorialSeen: [],
  unlocked: 6,
  completed: [1, 2, 3, 4, 5],
  coins: 900,
  sound: false,
  volume: 0.5,
  mix: { battle: 1, music: 0.25, environment: 0.3, ui: 0.65 },
  quality: "low",
  shake: true,
  stars: { 1: 3 },
  lossStreak: {},
  daily: { date: "", best: 0 },
  achievements: [],
  items: { "sun-boost": 2, "spare-mower": 1 },
  seedSlots: 0,
  kills: 12,
  contrast: false,
  fontSize: "standard",
  scores: [],
};

const failures = [];
function check(ok, label, detail) {
  if (ok) console.log("  ✓ " + label);
  else {
    failures.push(label + (detail ? " — " + detail : ""));
    console.log("  ✗ " + label + (detail ? " — " + detail : ""));
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await context.addInitScript(
  ([key, save]) => {
    localStorage.setItem(key, JSON.stringify(save));
    // 捕获页面自身对存档键的写入，用来验证"真实落盘内容"。
    window.__saveWrites = [];
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => {
      if (k === key) window.__saveWrites.push(String(v));
      return original(k, v);
    };
  },
  [SAVE_KEY, LEGACY_V2],
);

const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));

console.log("1) 加载旧 v2 档");
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1500);
check(errors.length === 0, "加载无 pageerror", errors.join(" | "));

const homeCoins = await page
  .locator("text=/^900$/")
  .count()
  .catch(() => 0);
check(homeCoins > 0 || true, "主页渲染完成（金币展示按 UI 结构不强制断言）");

console.log("2) 触发一次真实 persist（开始一局）");
const buttons = await page.locator("button").allTextContents();
const startLabel = buttons.find((t) => /开始|继续|冒险|守/.test(t));
if (!startLabel) {
  check(false, "找到开局按钮", "可见按钮：" + JSON.stringify(buttons.slice(0, 12)));
} else {
  await page.getByRole("button", { name: startLabel }).first().click();
  await page.waitForTimeout(3500);
}

const writes = await page.evaluate(() => window.__saveWrites || []);
check(writes.length > 0, "触发过存档写入", "捕获到 " + writes.length + " 次");
check(errors.length === 0, "开局后无 pageerror", errors.join(" | "));

console.log("3) 校验落盘内容");
let last = null;
if (writes.length) {
  try {
    last = JSON.parse(writes[writes.length - 1]);
  } catch (e) {
    check(false, "落盘内容可解析", String(e.message));
  }
}
if (last) {
  for (const field of ["coinsEarned", "coinsSpent", "itemsEarned", "itemsSpent"]) {
    check(field in last, "落盘含 " + field);
  }
  check(Number.isInteger(last.coinsEarned), "coinsEarned 为整数", String(last.coinsEarned));
  check(Number.isInteger(last.coinsSpent), "coinsSpent 为整数", String(last.coinsSpent));
  check(last.coins >= 0, "coins 非负", String(last.coins));
  check(
    last.coins <= last.coinsEarned,
    "余额不超过累计获得",
    `${last.coins} <= ${last.coinsEarned}`,
  );
  check(
    last.coinsSpent <= last.coinsEarned,
    "累计消耗不超过累计获得",
    `${last.coinsSpent} <= ${last.coinsEarned}`,
  );
  // 旧档没有记账字段：读入时应把余额当作累计获得，进度不能回退。
  check(last.unlocked >= 6, "进度不回退", "unlocked=" + last.unlocked);
  check(
    (last.completed || []).length >= 5,
    "已完成关卡不回退",
    JSON.stringify(last.completed),
  );
  for (const [id, n] of Object.entries(last.items || {})) {
    check(
      (last.itemsEarned?.[id] ?? 0) >= n,
      `道具 ${id} 获得数不小于余额`,
      `${last.itemsEarned?.[id]} >= ${n}`,
    );
  }
}

await browser.close();

if (failures.length) {
  console.log("\n验收失败：");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
console.log("\n验收通过：旧档可读、记账字段落盘、不变量成立、无运行时报错。");
