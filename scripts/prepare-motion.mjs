import sharp from "sharp";
import { sourcePath } from "./lib/assets.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * 动作图集生成：把 AI 出图的「4 列 × N 行」源网格切成逐帧姿势，
 * 统一缩放、抠边、底部对齐后输出运行时精灵表，并写出一份可用图集清单，
 * 运行时按清单加载——所以「还没画」的角色不会让游戏去请求不存在的文件。
 *
 * 每个格子取「最大连通域 + 所有面积 >= 最大域 5% 的部件」的并集包围盒，
 * 这样气球、飘带、旋转残影等分离部件不会被丢掉，同时过滤碎屑。
 */
const ALPHA = 64;
const PART_SHARE = 0.05;
const PART_MIN = 300;

async function characterCrop(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const seen = new Uint8Array(width * height);
  const parts = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || data[start * 4 + 3] < ALPHA) continue;
    const stack = [start];
    seen[start] = 1;
    let area = 0, minX = width, minY = height, maxX = -1, maxY = -1;
    while (stack.length) {
      const p = stack.pop(), x = p % width, y = (p - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!seen[q] && data[q * 4 + 3] >= ALPHA) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    parts.push({ area, minX, minY, maxX, maxY });
  }
  if (!parts.length) throw new Error("Missing character in animation cell");
  parts.sort((a, b) => b.area - a.area);
  const total = parts.reduce((s, p) => s + p.area, 0);
  if (total < 500) throw new Error("Missing character in animation cell");
  const keep = parts.filter((p, i) => i === 0 || p.area >= Math.max(PART_MIN, parts[0].area * PART_SHARE));
  let left = width, top = height, right = 0, bottom = 0;
  for (const p of keep) {
    left = Math.min(left, p.minX);
    top = Math.min(top, p.minY);
    right = Math.max(right, p.maxX);
    bottom = Math.max(bottom, p.maxY);
  }
  left = Math.max(0, left - 1);
  top = Math.max(0, top - 1);
  right = Math.min(width - 1, right + 1);
  bottom = Math.min(height - 1, bottom + 1);
  return sharp(buffer)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
}

const baseline = existsSync("scripts/sprite-display-baseline.json")
  ? JSON.parse(await readFile("scripts/sprite-display-baseline.json", "utf8"))
  : {};
const base = (key, fallback) => baseline[key] ?? fallback;

/** 僵尸：基础 5 个沿用原参数，新增 21 个用 AI 图（208×248 与原烘焙帧一致）。 */
const sequenceZombies = new Set(["basic", "cone", "bucket", "garg", "pole"]);
const zombies = {
  basic: { targetHeight: 176, rows: 4, width: 192, height: 256, standing: 12 },
  cone: { targetHeight: 224, rows: 4, width: 192, height: 256, standing: 12 },
  bucket: { targetHeight: 202, rows: 4, width: 192, height: 256, standing: 12 },
  garg: { targetHeight: 192, rows: 4, width: 320, height: 320, standing: 8 },
  pole: { targetHeight: 250, rows: 6, width: 320, height: 320, standing: 8 },
};
for (const id of [
  "dancer", "backup", "football", "paper", "flag", "screen", "imp", "ladder",
  "pogo", "digger", "yeti", "jack", "zomboni", "bobsled", "catapult", "boss",
  "ducky", "snorkel", "dolphin", "balloon", "bungee",
]) {
  zombies[id] = {
    targetHeight: base("z-" + id, 170),
    rows: id === "dancer" ? 5 : 3,
    width: 208,
    height: 248,
    standing: 8,
  };
}

/**
 * 植物：大嘴花沿用原参数；16 帧组（发射/投掷）待机 0-7 / 蓄力 8-11 / 攻击 12-15；
 * 8 帧组（生产/特殊）待机 0-3 / 触发 4-7。没有源图的条目自动跳过。
 */
const plants = {
  chomper: { targetHeight: 210, rows: 4, width: 256, height: 256, standing: 4, group: "chomper" },
};
const plantTarget = (id) => Math.min(238, Math.round(base("p-" + id, 142) * 1.6));
for (const id of [
  "pea", "snowpea", "repeater", "three", "split", "gatling", "cactus", "star",
  "puff", "fume", "scaredy", "sea", "gloom", "arc", "cabbage", "kernel",
  "melon", "winter", "cob",
]) {
  plants[id] = { targetHeight: plantTarget(id), rows: 4, width: 256, height: 256, standing: 8, group: "motion" };
}
for (const id of [
  "sunflower", "cherry", "wallnut", "potato", "sunshroom", "grave", "hypno",
  "ice", "doom", "lily", "squash", "kelp", "jalapeno", "spike", "torch",
  "tallnut", "lantern", "blover", "pumpkin", "magnet", "pot", "coffee",
  "garlic", "umbrella", "marigold", "twin", "cattail", "goldmagnet",
  "spikerock", "imitater",
]) {
  plants[id] = { targetHeight: plantTarget(id), rows: 2, width: 256, height: 256, standing: 4, group: "motion" };
}

const jobs = [
  ...Object.entries(zombies).map(([id, spec]) => ({
    id, source: `zombie-${id}-motion`, manifest: sequenceZombies.has(id) ? null : "zombie", ...spec,
  })),
  ...Object.entries(plants).map(([id, { group, ...spec }]) => ({
    id, source: `plant-${id}-motion`, manifest: group === "motion" ? "plant" : null, ...spec,
  })),
];

await mkdir("public/assets/animation", { recursive: true });
const manifest = { zombie: {}, plant: {} };
const pending = [];

for (const { id, source: stem, manifest: bucket, targetHeight, rows, width: frameWidth, height: frameHeight, standing } of jobs) {
  const source = sourcePath(`assets-source/${stem}`);
  if (!source) { pending.push(stem); continue; }
  const count = rows * 4;
  const meta = await sharp(source).metadata();
  if (!meta.hasAlpha) throw new Error(`${id}: source must have real alpha transparency`);
  const alpha = (await sharp(source).stats()).channels[3];
  if (alpha.min !== 0 || alpha.max < 250 || alpha.mean > 245)
    throw new Error(`${id}: source background must contain transparent pixels`);
  const crops = [];
  for (let i = 0; i < count; i++) {
    const left = Math.round(((i % 4) * meta.width) / 4),
      top = Math.round((Math.floor(i / 4) * meta.height) / rows);
    const width = Math.round((((i % 4) + 1) * meta.width) / 4) - left,
      height = Math.round(((Math.floor(i / 4) + 1) * meta.height) / rows) - top;
    const crop = await sharp(source).extract({ left, top, width, height }).png().toBuffer();
    const trimmed = await characterCrop(crop);
    crops.push({ buffer: trimmed, meta: await sharp(trimmed).metadata() });
  }
  const standingHeights = crops
    .slice(0, standing)
    .map((c) => c.meta.height)
    .sort((a, b) => a - b);
  const factor = Math.min(
    targetHeight / standingHeights[Math.floor(standing / 2)],
    (frameWidth - 12) / Math.max(...crops.map((c) => c.meta.width)),
    (frameHeight - 16) / Math.max(...crops.map((c) => c.meta.height)),
  );
  const cells = [];
  for (let i = 0; i < count; i++) {
    const crop = crops[i],
      width = Math.round(crop.meta.width * factor),
      height = Math.round(crop.meta.height * factor);
    const frame = await sharp(crop.buffer).resize(width, height).png().toBuffer();
    cells.push({
      input: frame,
      left: (i % 4) * frameWidth + Math.round((frameWidth - width) / 2),
      top: Math.floor(i / 4) * frameHeight + frameHeight - 7 - height,
    });
  }
  await sharp({
    create: { width: frameWidth * 4, height: frameHeight * rows, channels: 4, background: "#00000000" },
  })
    .composite(cells)
    .webp({ quality: 80 })
    .toFile(`public/assets/animation/${id}.webp`);
  if (bucket) manifest[bucket][id] = count;
  console.log(`${id}: ${count} frames; uniform scale ${factor.toFixed(3)}`);
}

// 运行时清单：只列出真的生成了的文件，缺图角色不会被加载。
const manifestFile = "src/game/motion-manifest.generated.ts";
await writeFile(
  manifestFile,
  "/** 由 scripts/prepare-motion.mjs 生成，请勿手改。id → 帧数。 */\n" +
    `export const motionZombieFrames: Record<string, number> = ${JSON.stringify(manifest.zombie, null, 2)};\n\n` +
    `export const motionPlantFrames: Record<string, number> = ${JSON.stringify(manifest.plant, null, 2)};\n`,
);
console.log(`\n清单 ${manifestFile}：僵尸 ${Object.keys(manifest.zombie).length}，植物 ${Object.keys(manifest.plant).length}`);
if (pending.length) console.log(`待补源图 ${pending.length} 个：${pending.join(", ")}`);
