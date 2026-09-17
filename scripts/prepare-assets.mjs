import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ALPHA_MIN, MIN_AREA, PAD, CLAIM_SHARE, labelComponents, minCut, claimsFor } from "./lib/sprite-segmentation.mjs";
import { sourcePath, sourcePathOrThrow } from "./lib/assets.mjs";
import { existsSync } from "node:fs";
const root = "assets-source/";
const plantIds =
  "pea sunflower cherry wallnut potato snowpea chomper repeater puff sunshroom fume grave hypno scaredy ice doom lily squash three kelp jalapeno spike torch tallnut sea lantern cactus blover split star pumpkin magnet cabbage pot kernel coffee garlic umbrella marigold melon gatling twin gloom cattail winter goldmagnet spikerock cob imitater".split(
    " ",
  );
const zombieIds =
  "basic flag cone pole bucket paper screen football dancer backup ducky snorkel zomboni bobsled dolphin jack balloon digger pogo yeti bungee catapult garg imp boss ladder".split(
    " ",
  );
await mkdir("public/assets/portraits", { recursive: true });
await mkdir("public/assets/backgrounds", { recursive: true });
await mkdir("public/assets/fx", { recursive: true });

/* --------------------------------------------------------------------------
 * 连通域切图
 * 源图集并非等距网格：精灵大小不一，宽精灵和高精灵会跨过等分格线。
 * 因此改为按 alpha 连通域取真实包围盒，再按“与标称格重叠面积”归属到 id。
 * 两个精灵互相粘连时，用“最小实心像素割线”把它们分开。
 * ------------------------------------------------------------------------ */

const overridesPath = "scripts/asset-crop-overrides.json";
const overrides = existsSync(overridesPath)
  ? JSON.parse(await readFile(overridesPath, "utf8"))
  : {};
/**
 * 目标显示高度基线（portrait 像素）。立绘要按统一画布归一化，宽高比不同的精灵
 * 在“按最长边缩放”后内容高度会不一致，导致战斗中大小突变。这里以基线为
 * 参考高度，切图时算出每个精灵的显示补偿，输出到 sprite-scale.generated.ts。
 */
const baseline = existsSync("scripts/sprite-display-baseline.json")
  ? JSON.parse(await readFile("scripts/sprite-display-baseline.json", "utf8"))
  : {};
const corrections = {};

async function segment(file, cols, rows, ids, prefix, w, h, folder = "portraits") {
  const path = sourcePathOrThrow(root + file.replace(/\.[^.]+$/, ""));
  const { W, H, comps } = await labelComponents(path);
  const report = {
    file,
    splits: [],
    uncovered: [],
    sheetCut: [],
    bbox: {},
    covered: 0,
    splitComps: new Set(),
    unused: 0,
  };
  const { claims } = claimsFor(comps, cols, rows, ids.length, W, H, report);
  const over = overrides[file] || {};
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    let left, top, right, bottom;
    if (over[id]) {
      [left, top, right, bottom] = over[id];
      report.bbox[id] = "override";
    } else {
      const pixels = claims[i];
      if (!pixels.length) {
        report.uncovered.push(id);
        return null; // 交给调用方决定是否中断
      }
      report.covered++;
      let minX = W,
        minY = H,
        maxX = -1,
        maxY = -1;
      for (const p of pixels) {
        const x = p % W,
          y = (p - x) / W;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      left = Math.max(0, minX - PAD);
      top = Math.max(0, minY - PAD);
      right = Math.min(W, maxX + 1 + PAD);
      bottom = Math.min(H, maxY + 1 + PAD);
      if (minX === 0 || minY === 0 || maxX === W - 1 || maxY === H - 1)
        report.sheetCut.push(id);
    }
    const crop = await sharp(path)
      .extract({ left, top, width: right - left, height: bottom - top })
      .png()
      .toBuffer();
    const trimmed = await sharp(crop).trim({ threshold: 18 }).png().toBuffer();
    const fitted = await sharp(trimmed)
      .resize(w - 14, h - 18, { fit: "inside" })
      .png()
      .toBuffer();
    const m = await sharp(fitted).metadata();
    // 显示补偿：把内容高度拉回基线，保证切图修复不改变战斗中的大小观感。
    const target = baseline[prefix + id];
    if (target && m.height) {
      const raw = target / m.height;
      corrections[prefix + id] = +Math.max(0.6, Math.min(1.8, raw)).toFixed(3);
    }
    await sharp({
      create: { width: w, height: h, channels: 4, background: "#00000000" },
    })
      .composite([
        {
          input: fitted,
          left: Math.round((w - m.width) / 2),
          top: h - m.height - 7,
        },
      ])
      .webp({ quality: 80 })
      .toFile(`public/assets/${folder}/${prefix}${id}.webp`);
  }
  report.components = comps.length;
  return report;
}

/** VFX 图集是规整网格，沿用等分切图。 */
async function splitGrid(file, cols, rows, ids, prefix, w, h, folder = "portraits") {
  const path = sourcePathOrThrow(root + file.replace(/\.[^.]+$/, "")),
    meta = await sharp(path).metadata();
  for (let i = 0; i < ids.length; i++) {
    const x = Math.round(((i % cols) * meta.width) / cols),
      y = Math.round((Math.floor(i / cols) * meta.height) / rows),
      right = Math.round((((i % cols) + 1) * meta.width) / cols),
      bottom = Math.round(((Math.floor(i / cols) + 1) * meta.height) / rows);
    const crop = await sharp(path)
      .extract({ left: x, top: y, width: right - x, height: bottom - y })
      .png()
      .toBuffer();
    const trimmed = await sharp(crop).trim({ threshold: 18 }).png().toBuffer();
    const fitted = await sharp(trimmed)
      .resize(w - 14, h - 18, { fit: "inside" })
      .png()
      .toBuffer();
    const m = await sharp(fitted).metadata();
    await sharp({
      create: { width: w, height: h, channels: 4, background: "#00000000" },
    })
      .composite([
        {
          input: fitted,
          left: Math.round((w - m.width) / 2),
          top: h - m.height - 7,
        },
      ])
      .webp({ quality: 80 })
      .toFile(`public/assets/${folder}/${prefix}${ids[i]}.webp`);
  }
}

const reports = [];
for (const [file, cols, rows, ids, prefix, w, h] of [
  ["plants.png", 7, 7, plantIds, "p-", 160, 160],
  ["zombies.png", 6, 5, zombieIds, "z-", 160, 200],
]) {
  const report = await segment(file, cols, rows, ids, prefix, w, h);
  if (!report)
    throw new Error(`${file}: 有精灵没有匹配到连通域，请检查 asset-crop-overrides.json`);
  reports.push(report);
}
await splitGrid(
  "fx.png",
  4,
  4,
  Array.from({ length: 16 }, (_, i) => String(i)),
  "fx-",
  192,
  192,
  "fx",
);

// 输出显示补偿表（切图时算出，供 proportions.ts 使用）
const corrKeys = Object.keys(corrections).sort();
await writeFile(
  "src/game/sprite-scale.generated.ts",
  "/** 由 scripts/prepare-assets.mjs 生成，请勿手改。\n" +
    " * 立绘裁切归一化后的显示尺寸补偿：把每个精灵的内容高度拉回\n" +
    " * scripts/sprite-display-baseline.json 记录的目标高度，避免切图修复改变战斗大小。\n" +
    " */\n" +
    "export const spriteScaleCorrection: Record<string, number> = {\n" +
    corrKeys.map((k) => `  "${k}": ${corrections[k]},`).join("\n") +
    "\n};\n",
);
console.log(`显示补偿表：${corrKeys.length} 项 → src/game/sprite-scale.generated.ts`);

console.log("== 连通域切图报告 ==");
for (const r of reports) {
  const total = r.covered + Object.keys(r.bbox).length;
  console.log(`${r.file}: 连通域 ${r.components} 个 → 覆盖 ${total} 个精灵`);
  for (const s of r.splits) console.log("  " + s);
  if (r.uncovered.length) console.log("  ⚠ 未覆盖: " + r.uncovered.join(", "));
  if (r.sheetCut.length)
    console.log("  ⚠ 内容贴到图集边界（源图本身被截断，需美术补画）: " + r.sheetCut.join(", "));
}

await sharp(sourcePathOrThrow(root + "day"))
  .resize(1200, 690, { fit: "fill" })
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/day.webp");
// 月下墓园：优先使用独立美术 assets-source/night.png；没有时退回“白天压暗调色”
const nightSrc = sourcePath(root + "night");
if (nightSrc) {
  await sharp(nightSrc)
    .resize(1200, 690, { fit: "fill" })
    .webp({ quality: 84 })
    .toFile("public/assets/backgrounds/night.webp");
  console.log("Night background: 使用独立美术 " + nightSrc);
} else {
  await sharp("public/assets/backgrounds/day.webp")
    .modulate({ brightness: 0.48, saturation: 0.65 })
    .tint("#778da9")
    .webp({ quality: 80 })
    .toFile("public/assets/backgrounds/night.webp");
  console.log("Night background: ⚠ 未找到 assets-source/night.png，暂用白天压暗调色代替");
}
await sharp("public/assets/portraits/p-pea.webp")
  .resize(48, 48)
  .png()
  .toFile("public/favicon.png");
console.log("Prepared 49 plant, 26 zombie, 16 VFX WebPs and backgrounds.");
await sharp(sourcePathOrThrow(root + "pool"))
  .resize(1200, 690, { fit: "fill" })
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/pool.webp");
await sharp(sourcePathOrThrow(root + "roof"))
  .resize(1200, 690, { fit: "fill" })
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/roof.webp");

// Align the generated pool bands to the exact two water lanes, without moving the house.
const pool = await sharp("public/assets/backgrounds/pool.webp").png().toBuffer();
const bands = [];
for (const [from, to, start, end] of [
  [116, 252, 116, 284],
  [252, 431, 284, 452],
  [431, 620, 452, 620],
]) {
  const input = await sharp(pool)
    .extract({ left: 210, top: from, width: 891, height: to - from })
    .resize(891, end - start)
    .png()
    .toBuffer();
  bands.push({ input, left: 210, top: start });
}
await sharp(pool)
  .composite(bands)
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/pool.webp");

// 迷雾后院：优先使用独立美术 assets-source/fog.png；
// 没有时退回“泳池压暗蓝化”的旧方案，并明确警告。
const fogSrc = sourcePath(root + "fog");
if (fogSrc) {
  await sharp(fogSrc)
    .resize(1200, 690, { fit: "fill" })
    .webp({ quality: 84 })
    .toFile("public/assets/backgrounds/fog.webp");
  console.log("Fog background: 使用独立美术 " + fogSrc);
} else {
  await sharp("public/assets/backgrounds/pool.webp")
    .modulate({ brightness: 0.48, saturation: 0.65 })
    .tint("#778da9")
    .webp({ quality: 80 })
    .toFile("public/assets/backgrounds/fog.webp");
  console.log("Fog background: ⚠ 未找到 assets-source/fog.png，暂用泳池压暗蓝化代替");
}
