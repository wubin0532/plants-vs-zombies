/**
 * 真机（Chromium）迷雾排查：进入真实迷雾关，按时间采样截图并分析。
 * 用法：node tests/probe-fog.mjs [levelId] [url]
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const level = Number(process.argv[2] || 31);
const url = process.argv[3] || process.env.PVZ_URL || "http://127.0.0.1:5199/";
const SAVE_KEY = "pvz-garden-save-v1::guest";
const OUT = "output/fog-probe";
mkdirSync(OUT, { recursive: true });

const save = {
  version: 2,
  tutorialSeen: [
    "elements-transplant","elements-arc","elements-belt","elements-bowling",
    "elements-whack","elements-vases","elements-boss",
  ],
  unlocked: 50,
  completed: Array.from({ length: 49 }, (_, i) => i + 1),
  coins: 9999,
  coinsEarned: 9999,
  coinsSpent: 0,
  sound: false,
  volume: 0.3,
  mix: { battle: 1, music: 0.25, environment: 0.3, ui: 0.65 },
  quality: "high",
  shake: false,
  stars: {},
  lossStreak: {},
  daily: { date: "", best: 0 },
  achievements: [],
  items: {},
  itemsEarned: {},
  itemsSpent: {},
  seedSlots: 4,
  kills: 0,
  contrast: false,
  fontSize: "standard",
  options: {},
  scores: [],
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await context.addInitScript(
  ([key, value]) => localStorage.setItem(key, JSON.stringify(value)),
  [SAVE_KEY, save],
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/00-home.png` });

// 直接进入关卡：主页 → 关卡地图 → 点关卡卡片 → 选卡页 → 开战。
const homeButtons = await page.locator("button").allTextContents();
console.log("主页按钮:", JSON.stringify(homeButtons.slice(0, 10)));
const mapLabel = homeButtons.find((t) => t.includes("关卡地图"));
if (mapLabel) {
  await page.getByRole("button", { name: mapLabel }).first().click();
  await page.waitForTimeout(800);
}
await page.screenshot({ path: `${OUT}/01-map.png`, fullPage: true });

// 地图按"世界"分组，先切到目标关卡所属的世界（每 10 关一个世界）。
const worldIndex = Math.floor((level - 1) / 10);
const tabs = page.locator(".world-tabs button");
console.log("世界数:", await tabs.count());
if ((await tabs.count()) > worldIndex) {
  await tabs.nth(worldIndex).click();
  await page.waitForTimeout(500);
}
const cards = page.locator(".level-grid button");
const cardCount = await cards.count();
console.log("当前世界关卡卡片数:", cardCount);
if (cardCount > 0) {
  const withinWorld = ((level - 1) % 10) + 1;
  await cards.nth(Math.min(withinWorld, cardCount) - 1).click();
} else {
  console.log("找不到第", level, "关的卡片");
}
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/02-select.png`, fullPage: true });
const selectButtons = await page.locator("button").allTextContents();
console.log("选卡页按钮:", JSON.stringify(selectButtons.slice(-6)));

const goLabel = selectButtons.find((t) => t.includes("一起守住庭院"));
if (goLabel) await page.getByRole("button", { name: goLabel }).first().click();
else await page.keyboard.press("Enter");

const canvas = page.locator("canvas").first();
await canvas.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
await page.waitForTimeout(500);

const marks = [0, 3000, 6000, 10000, 16000, 24000, 32000];
let elapsed = 0;
for (const mark of marks) {
  const wait = mark - elapsed;
  if (wait > 0) await page.waitForTimeout(wait);
  elapsed = mark;
  const file = `${OUT}/t${String(mark).padStart(5, "0")}.png`;
  await page.screenshot({ path: file });
  const box = await canvas.boundingBox().catch(() => null);
  const probe = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const ctx = c.getContext("2d");
    if (!ctx) return { note: "no 2d ctx" };
    return { w: c.width, h: c.height };
  });
  console.log(`t=${(mark / 1000).toFixed(1)}s -> ${file}`, JSON.stringify({ box, probe }));
}
writeFileSync(`${OUT}/errors.json`, JSON.stringify(errors, null, 2));
console.log("pageerror:", errors.length ? JSON.stringify(errors) : "none");
await browser.close();
