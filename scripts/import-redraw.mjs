/**
 * AI 重绘图导入器。
 *
 * 用法：把 AI 出的图按 docs/redraw-brief.md 里的文件名放进 assets-source/redraw/，
 * 然后执行 `npm run assets:import`。脚本会自动裁边、缩放、对齐锚点、转 webp，
 * 并把结果写进 public/assets/ 下的正确位置（底图写入 assets-source/ 供后续流程使用）。
 *
 * 尺寸不必精确：脚本按下方规则归一化；只认文件名。
 */
import sharp from "sharp";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { sourcePath } from "./lib/assets.mjs";

const IN = "assets-source/redraw/";
/** 原始泳池美术：作为铺装填充源，透视与花纹与游戏网格一致 */
const POOL_SOURCE = sourcePath("assets-source/pool");
/** 文件名主干：fog.webp / fog.png 都取 fog */
const stemOf = (name) => name.replace(/\.[^.]+$/, "");
const done = [];
const skipped = [];

const trim = (buf) => sharp(buf).trim({ threshold: 12 }).png().toBuffer();


/* ---------------------------------------------------------------------------
 * 底图几何校准
 * AI 出图的草坪/水路位置不可能刚好落在游戏网格上，这里自动检测并做分段纵向
 * 重映射（全宽，避免左右接缝），保证：
 *   草坪 y 116-620（1200×690 空间）、迷雾关水带 y 284-452
 * ------------------------------------------------------------------------- */
const LOGICAL = { w: 1200, h: 690, lawnL: 210, lawnR: 1101, lawnTop: 116, lawnBottom: 620, waterTop: 284, waterBottom: 452 };

/** 在 1200×690 逻辑空间里检测草坪与水域的上下边界 */
async function detectBands(buf) {
  const { data, info } = await sharp(buf).resize(LOGICAL.w, LOGICAL.h, { fit: "fill" }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, C = info.channels;
  const x0 = Math.floor(w * 0.25), x1 = Math.floor(w * 0.8);
  const wx0 = Math.floor(w * 0.175), wx1 = Math.floor(w * 0.9175);
  const grass = [], water = [];
  let grassTop = -1;
  for (let y = 0; y < h; y++) {
    let g = 0, wa = 0, n = 0, wn = 0;
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * C, r = data[o], gg = data[o + 1], b = data[o + 2];
      n++; if (gg > r + 12 && gg > 55 && gg < 160) g++;
    }
    // 只在草坪范围内找水，避免把夜空算成水域
    if (grassTop < 0 && grass[y] > 0.45) grassTop = y;
    for (let x = wx0; x < wx1; x += 2) {
      const o = (y * w + x) * C, r = data[o], b = data[o + 2];
      wn++; if ((grassTop < 0 || y > grassTop) && b > 150 && b - r > 70) wa++;
    }
    grass.push(g / n); water.push(wa / wn);
  }
  /**
   * 取"最宽的水域区间"：泳池中间的泳道分隔带会把水带切成两段，
   * 所以先找出所有连续段，再把间隔小于 maxGap 的合并，取最宽的一段。
   */
  const widestSpan = (arr, th, minRun = 5, maxGap = 22) => {
    const runs = [];
    let start = -1;
    for (let i = 0; i <= arr.length; i++) {
      const on = i < arr.length && arr[i] > th;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        if (i - start >= minRun) runs.push([start, i - 1]);
        start = -1;
      }
    }
    if (!runs.length) return null;
    const merged = [runs[0].slice()];
    for (const r of runs.slice(1)) {
      const last = merged[merged.length - 1];
      if (r[0] - last[1] <= maxGap) last[1] = r[1];
      else merged.push(r.slice());
    }
    return merged.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  };
  // 草坪会被泳池切成上下两块，所以用首末行；水域则必须用最长连续段。
  const spanRows = (arr, th) => {
    const idx = arr.map((v, i) => (v > th ? i : -1)).filter((i) => i >= 0);
    return idx.length > 8 ? [idx[0], idx[idx.length - 1]] : null;
  };
  return { grass: spanRows(grass, 0.45), water: widestSpan(water, 0.6) };
}

/** 分段纵向重映射（全宽）。bands: [srcFrom, srcTo, dstFrom, dstTo] */
async function remapBands(base, bands, W, H) {
  const pieces = [];
  for (const [sf, st, df, dt] of bands) {
    const input = await sharp(base)
      .extract({ left: 0, top: sf, width: W, height: st - sf })
      .resize(W, dt - df)
      .png()
      .toBuffer();
    pieces.push({ input, left: 0, top: df });
  }
  return sharp(base).composite(pieces).png().toBuffer();
}

/**
 * 把泳池横向收进可玩水路范围。
 *
 * AI 出的迷雾底图泳池比网格宽得多（实测水面 100-1179，而水路只有 210-1101），
 * 结果左侧割草机整台站在水上、睡莲格也对不准水面。
 * 处理：把泳池块（含压边）横向压缩到 [210,1101]，空出来的两侧用
 * 左侧铺装（上下平铺，避开那盆绿植）与下方草地填补，都不做拉伸变形。
 */
async function fitPoolWidth(buf) {
  const W = 2400, H = 1380, k = 2;
  const base = await sharp(buf).resize(W, H, { fit: "fill" }).png().toBuffer();
  const waterT = LOGICAL.waterTop * k, waterB = LOGICAL.waterBottom * k;

  // 1) 量出水面横向范围
  const { data, info } = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const C = info.channels;
  const isWater = (r, g, b) => b > 150 && b - r > 70;
  let L = -1, R = -1;
  for (let x = 0; x < W; x++) {
    let hit = 0, n = 0;
    for (let y = waterT; y < waterB; y += 4) {
      const o = (y * W + x) * C; n++;
      if (isWater(data[o], data[o + 1], data[o + 2])) hit++;
    }
    if (hit / n > 0.5) { if (L < 0) L = x; R = x; }
  }
  if (L < 0) {
    // 诊断信息：水面积分为 0 时把采样范围和最大列占比带上，便于定位
    let maxFrac = 0;
    for (let x = 0; x < W; x += 8) {
      let hit = 0, n = 0;
      for (let y = waterT; y < waterB; y += 4) { const o = (y * W + x) * C; n++; if (isWater(data[o], data[o + 1], data[o + 2])) hit++; }
      maxFrac = Math.max(maxFrac, hit / n);
    }
    return { out: base, note: `未检测到水面（采样行 ${waterT}-${waterB}，最大列占比 ${maxFrac.toFixed(2)}）` };
  }

  const pad = 18 * k;                       // 压边厚度
  const blockL = Math.max(0, L - pad), blockR = Math.min(W, R + pad);
  const targetL = LOGICAL.lawnL * k, targetR = LOGICAL.lawnR * k;   // 210 / 1101
  const blockT = waterT - 26 * k, blockH = (waterB - waterT) + 52 * k;
  const gapL = targetL - blockL, gapR = blockR - targetR;
  if (gapL < 8 && gapR < 8) return { out: base, note: "泳池横向已在网格内，无需收拢" };

  const layers = [];
  // 2) 池块压缩到目标宽度
  const pool = await sharp(base)
    .extract({ left: blockL, top: blockT, width: blockR - blockL, height: blockH })
    .resize(targetR - targetL, blockH)
    .png()
    .toBuffer();
  layers.push({ input: pool, left: targetL, top: blockT });
  // 3) 左侧空档：用原始泳池美术同坐标的铺装区做填充源（透视与花纹天然正确），
  //    再做夜景调色匹配 + 边缘羽化，避免斜条纹与矩形硬边。
  if (gapL > 8 && POOL_SOURCE) {
    const src = await sharp(POOL_SOURCE).resize(W, H, { fit: "fill" }).png().toBuffer();
    const patch = await sharp(src)
      .extract({ left: blockL, top: blockT, width: targetL - blockL, height: blockH })
      .png()
      .toBuffer();
    const meanOf = async (image) => {
      const st = await sharp(image)
        .extract({ left: 0, top: Math.round(blockT), width: Math.round(60 * k), height: Math.round(blockH) })
        .stats();
      return st.channels.slice(0, 3).map((c) => c.mean);
    };
    const meanFog = await meanOf(base);
    const meanDay = await meanOf(src);
    const gain = meanFog.map((m, i) => Math.max(0.15, Math.min(1.5, m / Math.max(1, meanDay[i]))));
    let graded = await sharp(patch)
      .recomb([[gain[0], 0, 0], [0, gain[1], 0], [0, 0, gain[2]]])
      .png()
      .toBuffer();
    // 再向"左侧紧邻的铺装"做一次配色对齐：否则夜景调色会把铺装压得偏蓝，
    // 观感上像水面，质检也会把它判成水（这次踩过的坑）。
    const neighbor = await sharp(base)
      .extract({ left: 0, top: Math.round(blockT), width: Math.round(70 * k), height: Math.round(blockH) })
      .stats();
    const cur = await sharp(graded).stats();
    const fix = neighbor.channels.slice(0, 3).map((c, i) =>
      Math.max(0.4, Math.min(1.4, c.mean / Math.max(1, cur.channels[i].mean))),
    );
    graded = await sharp(graded)
      .recomb([[fix[0], 0, 0], [0, fix[1], 0], [0, 0, fix[2]]])
      .png()
      .toBuffer();
    const pw = targetL - blockL;
    const svgMask = '<svg xmlns="http://www.w3.org/2000/svg" width="' + pw + '" height="' + blockH + '">' +
      '<rect x="0" y="' + Math.round(20 * k) + '" width="' + pw + '" height="' + (blockH - Math.round(40 * k)) + '" fill="#fff"/></svg>';
    const mask = await sharp(Buffer.from(svgMask))
      .blur(Math.round(9 * k))
      .png()
      .toBuffer();
    const feathered = await sharp(graded).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    layers.push({ input: feathered, left: blockL, top: blockT });
  }
  // 4) 右侧空档：取泳池下方的草地（同宽同高，零变形）
  if (gapR > 8) {
    // 采样区必须留在画布内（否则 sharp 报 bad extract area）
    const srcTop = Math.min(waterB + 60 * k, H - blockH);
    const grass = await sharp(base)
      .extract({ left: targetR, top: srcTop, width: Math.min(gapR, W - targetR), height: blockH })
      .png()
      .toBuffer();
    layers.push({ input: grass, left: targetR, top: blockT });
  }
  return {
    out: await sharp(base).composite(layers).png().toBuffer(),
    note: `泳池横向 ${(L / k).toFixed(0)}-${(R / k).toFixed(0)} → 收进 210-1101（左补铺装 ${(gapL / k).toFixed(0)}px、右补草地 ${(gapR / k).toFixed(0)}px）`,
  };
}

/** 自动校准一张底图；withWater=true 时同时对齐水带 */
async function calibrateBackground(buf, withWater) {
  const W = 2400, H = 1380, k = 2;
  const base = await sharp(buf).resize(W, H, { fit: "fill" }).png().toBuffer();
  const det = await detectBands(buf);
  if (!det.grass) return { out: base, note: "未检测到草坪，跳过校准" };
  const [gTop, gBottom] = det.grass;
  let bands, note;
  if (withWater && det.water) {
    const [wTop, wBottom] = det.water;
    bands = [
      [gTop * k, wTop * k, LOGICAL.lawnTop * k, LOGICAL.waterTop * k],
      [wTop * k, wBottom * k, LOGICAL.waterTop * k, LOGICAL.waterBottom * k],
      [wBottom * k, gBottom * k, LOGICAL.waterBottom * k, LOGICAL.lawnBottom * k],
    ];
    note = `草坪 ${gTop}-${gBottom}，水带 ${wTop}-${wBottom} → 对齐 116-620 / 284-452（三段重映射）`;
  } else {
    bands = [[gTop * k, gBottom * k, LOGICAL.lawnTop * k, LOGICAL.lawnBottom * k]];
    note = `草坪 ${gTop}-${gBottom} → 对齐 116-620`;
  }
  const remapped = await remapBands(base, bands, W, H);
  if (withWater) {
    const fixed = await fitPoolWidth(remapped);
    return { out: fixed.out, note: `${note}；${fixed.note}` };
  }
  return { out: remapped, note };
}

/** 云雾无缝：把左边缘与右边缘交叉淡化，消除平铺接缝 */
async function makeSeamless(buf, vertical = true) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, C = info.channels;
  const A = C - 1; // alpha 通道
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  // 只校正 alpha：云雾这类软透明贴图"看不看得见"由 alpha 决定，
  // 而边缘像素的 RGB 往往是透明区的垃圾值——把 RGB 一起摊开会摊出彩色竖条（踩过这个坑）。
  const fixLine = (get, set, len) => {
    const d = data[get(0) + A] - data[get(len - 1) + A];
    if (!d) return;
    for (let i = 0; i < len; i++) data[set(i) + A] = clamp(data[set(i) + A] + (d * i) / (len - 1));
  };
  for (let y = 0; y < h; y++) fixLine((i) => (y * w + i) * C, (i) => (y * w + i) * C, w);
  if (vertical) for (let x = 0; x < w; x++) fixLine((i) => (i * w + x) * C, (i) => (i * w + x) * C, h);
  return sharp(data, { raw: { width: w, height: h, channels: C } }).png().toBuffer();
}

/**
 * 水面叠加层专用处理：AI 出的水面是一整条不透明贴图，直接盖上去会把背景泳池糊掉。
 * 这里压低整体透明度，并把上下边缘渐隐，保证它是"叠加层"而不是"遮罩"。
 */
async function waterStrip(buf) {
  const W = 891, H = 168;
  const { data, info } = await sharp(buf).resize(W, H, { fit: "fill" }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const C = info.channels, fade = H * 0.16;
  for (let y = 0; y < H; y++) {
    const t = Math.min(1, Math.min(y, H - 1 - y) / fade);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C;
      data[o + 3] = Math.round(data[o + 3] * 0.55 * t);
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: C } }).png().toBuffer();
}


/* ---------------------------------------------------------------------------
 * 纯色背景自动抠图
 * AI 工具（如 ChatGPT/DALL·E）通常不支持透明 PNG，只能出纯色背景。
 * 这里从图片四边泛洪，把与背景色接近且**与边缘连通**的像素变透明，
 * 因此不会在美术内部的相近颜色上打洞（例如太阳的白色高光）。
 * ------------------------------------------------------------------------- */
async function chromaKey(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, C = info.channels;
  // 用四角像素投票取背景色
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => {
    const o = (y * w + x) * C;
    return [data[o], data[o + 1], data[o + 2]];
  });
  const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, p) => s + p[c], 0) / 4));
  const near = (o) =>
    Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2]) < 90;
  const visited = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (visited[p]) continue;
    visited[p] = 1;
    if (!near(p * C)) continue;
    data[p * C + 3] = 0;
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return sharp(data, { raw: { width: w, height: h, channels: C } }).png().toBuffer();
}

/** 如果图片没有透明通道（AI 出的纯色底），先抠图再进入后续流程 */
async function ensureAlphaBuffer(buf) {
  const meta = await sharp(buf).metadata();
  if (meta.hasAlpha) {
    // 已有 alpha，但仍可能是“棋盘格底”被烧进像素；检查四角是否不透明
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const C = info.channels, w = info.width;
    const cornerAlpha = [0, w - 1, (info.height - 1) * w, info.height * w - 1].map((p) => data[p * C + 3]);
    if (cornerAlpha.every((a) => a > 200)) return chromaKey(buf);
    return buf;
  }
  return chromaKey(buf);
}

/** 透明画布合成：把内容按指定锚点放进去 */
async function place(buf, w, h, anchor) {
  const fitted = await sharp(buf)
    .resize({ width: w, height: h, fit: "inside" })
    .png()
    .toBuffer();
  const m = await sharp(fitted).metadata();
  const left = Math.round((w - m.width) / 2);
  const top =
    anchor === "bottom"
      ? h - m.height
      : anchor === "bottom-8"
        ? Math.round(h * 0.92) - m.height
        : Math.round((h - m.height) / 2);
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fitted, left: Math.max(0, left), top: Math.max(0, top) }])
    .png()
    .toBuffer();
}

/** 整幅底图/整幅水面不能抠背景，否则会把天空、墙面一起泛洪掉 */
const FULL_FRAME = new Set(["fog", "night", "water-strip", "water-ripple"]);


async function importFile(name) {
  const src = IN + name;
  // 单体资产先做纯色底抠图（AI 出图常常带不透明底）；整幅图跳过
  const raw = await sharp(src).png().toBuffer();
  const buf = FULL_FRAME.has(stemOf(name)) ? raw : await ensureAlphaBuffer(raw);

  // 1) 底图：写入 assets-source/，由 prepare-assets 统一缩放并用
  if (stemOf(name) === "fog" || stemOf(name) === "night") {
    const { out, note } = await calibrateBackground(buf, stemOf(name) === "fog");
    // 源图统一用 webp（q92 视觉无损），避免仓库里堆 PNG
    await writeFile(`assets-source/${stemOf(name)}.webp`, await sharp(out).webp({ quality: 92, effort: 6 }).toBuffer());
    done.push(`${name} → assets-source/${stemOf(name)}.webp (2400×1380)｜${note}`);
    return;
  }
  // 2) 云雾与暖光：直接覆盖运行时贴图
  if (/^mist-[abc]$/.test(stemOf(name)) || stemOf(name) === "glow-lantern" || stemOf(name) === "overcast-cloud") {
    const glow = stemOf(name) === "glow-lantern";
    const w = glow ? 256 : 1024, h = glow ? 256 : 512;
    const seamless = glow ? buf : await makeSeamless(await sharp(buf).resize(w, h, { fit: "fill" }).png().toBuffer(), true);
    const out = await sharp(seamless).resize(w, h, { fit: "fill" }).webp({ quality: 90 }).toBuffer();
    await writeFile(`public/assets/mist/${stemOf(name)}.webp`, out);
    done.push(`${name} → public/assets/mist/ (${w}×${h})`);
    return;
  }
  // 3) 小推车：任意尺寸的 4 帧横排 → 归一化为 512×96，触地线 y=89
  if (stemOf(name) === "mower") {
    const meta = await sharp(buf).metadata();
    const fw = Math.floor((meta.width ?? 512) / 4);
    const canvas = Buffer.alloc(512 * 96 * 4);
    for (let i = 0; i < 4; i++) {
      const frame = await trim(await sharp(buf).extract({ left: i * fw, top: 0, width: fw, height: meta.height ?? 96 }).png().toBuffer());
      // 游戏 origin 是 89/96，即"车轮触地线"在 y=89。所以内容只允许占 89px 高，
      // 底边贴 y=88，下面 7px 留空；否则车会整体下沉（实测会沉 6px）。
      const placed = await place(frame, 128, 89, "bottom");
      const { data, info } = await sharp(placed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const col = i * 128;
      for (let y = 0; y < Math.min(96, info.height); y++)
        for (let x = 0; x < Math.min(128, info.width); x++) {
          const s = (y * info.width + x) * info.channels, d = (y * 512 + x + col) * 4;
          canvas[d] = data[s];
          canvas[d + 1] = data[s + 1];
          canvas[d + 2] = data[s + 2];
          canvas[d + 3] = data[s + 3];
        }
    }
    await sharp(canvas, { raw: { width: 512, height: 96, channels: 4 } }).png().toFile("public/assets/mower.png");
    done.push("mower.png → public/assets/mower.png (512×96，4 帧，触地线对齐)");
    return;
  }
  // 4) 地形：底部对齐，四周留边
  const terrain = { grave: [120, 140], vase: [110, 120], ice: [120, 90], crater: [120, 80] };
  const terrainId = stemOf(name);
  if (terrain[terrainId]) {
    const [w, h] = terrain[terrainId];
    const placed = await place(await trim(buf), w, h, "bottom-8");
    await sharp(placed).webp({ quality: 90 }).toFile(`public/assets/terrain/${terrainId}.webp`);
    done.push(`${terrainId}.png → public/assets/terrain/ (${w}×${h})`);
    return;
  }
  // 5) 水面
  if (stemOf(name) === "water-strip") {
    const out = await sharp(await waterStrip(buf)).webp({ quality: 90 }).toBuffer();
    await writeFile("public/assets/water/water-strip.webp", out);
    done.push("water-strip.png → public/assets/water/ (891×168，已压透明度 + 上下渐隐)");
    return;
  }
  if (stemOf(name) === "water-ripple") {
    const resized = await sharp(buf).resize(512, 128, { fit: "fill" }).png().toBuffer();
    const out = await sharp(await makeSeamless(resized, true)).webp({ quality: 90 }).toBuffer();
    await writeFile("public/assets/water/water-ripple.webp", out);
    done.push("water-ripple.png → public/assets/water/ (512×128，双向无缝)");
    return;
  }
  // 6b) 天气雨幕：256×256 双向无缝
  if (stemOf(name) === "rain-streak") {
    const resized = await sharp(buf).resize(256, 256, { fit: "fill" }).png().toBuffer();
    const out = await sharp(await makeSeamless(resized, true)).webp({ quality: 90 }).toBuffer();
    await writeFile("public/assets/weather/rain-streak.webp", out);
    done.push("rain-streak.png → public/assets/weather/ (256×256，双向无缝)");
    return;
  }
  // 6c) 水面动画：任意帧横排 → 归一化 2048×128（每帧 512×128，横向无缝）
  /** 把一张横排精灵表裁成 n 帧，逐帧归一化后拼回一张横排表并输出。 */
  const sheet = async (spec, out) => {
    const meta = await sharp(buf).metadata();
    const fw = Math.floor((meta.width ?? spec.n * spec.w) / spec.n);
    const fh = meta.height ?? spec.h;
    const frames = [];
    for (let i = 0; i < spec.n; i++) {
      const raw = await sharp(buf).extract({ left: i * fw, top: 0, width: fw, height: fh }).png().toBuffer();
      let frame;
      if (spec.water) {
        frame = await waterStrip(await sharp(await trim(raw)).resize(spec.w, spec.h, { fit: "fill" }).png().toBuffer());
      } else {
        const fitted = await sharp(await trim(raw)).resize(spec.w, spec.h, { fit: "fill" }).png().toBuffer();
        frame = spec.seamless ? await makeSeamless(fitted, false) : fitted;
      }
      frames.push(frame);
    }
    await sharp({ create: { width: spec.w * spec.n, height: spec.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(frames.map((f, i) => ({ input: f, left: i * spec.w, top: 0 })))
      .webp({ quality: 90 })
      .toFile(out);
    done.push(`${name} → ${out} (${spec.w * spec.n}×${spec.h}，${spec.n} 帧)`);
  };
  if (stemOf(name) === "water-frames") {
    await sheet({ n: 4, w: 512, h: 128, seamless: true }, "public/assets/water/water-frames.webp");
    return;
  }
  if (stemOf(name) === "water-strip-frames") {
    await sheet({ n: 4, w: 891, h: 168, water: true }, "public/assets/water/water-strip-frames.webp");
    return;
  }
  // 6d) 天气/氛围单张贴图（平铺类自动做无缝）
  const weatherSingle = {
    "heat-shimmer": { w: 256, h: 256, seamless: true },
    "cloud-shadow": { w: 1024, h: 512, seamless: true },
    "water-caustics": { w: 512, h: 256, seamless: true },
    "frost": { w: 256, h: 256, seamless: true },
    "snow-tile": { w: 256, h: 256, seamless: true },
    "blackout-glow": { w: 512, h: 512, seamless: false },
    "sun-flare": { w: 512, h: 512, seamless: false },
    "eclipse-mask": { w: 1024, h: 512, seamless: false },
  };
  if (weatherSingle[stemOf(name)]) {
    const spec = weatherSingle[stemOf(name)];
    let img = await sharp(buf).resize(spec.w, spec.h, { fit: "fill" }).png().toBuffer();
    if (spec.seamless) img = await makeSeamless(img, true);
    await sharp(img).webp({ quality: 90 }).toFile(`public/assets/weather/${stemOf(name)}.webp`);
    done.push(`${name} → public/assets/weather/ (${spec.w}×${spec.h})`);
    return;
  }
  // 6e) 天气/水面精灵表（雨滴、水花、落叶、天气图标）
  const weatherSheet = {
    "rain-splash": { n: 4, w: 128, h: 128, place: "bottom" },
    "water-splash": { n: 4, w: 128, h: 128, place: "bottom" },
    "wind-leaves": { n: 6, w: 128, h: 128, place: "center" },
    "icon-weather": { n: 5, w: 128, h: 128, place: "center" },
  };
  if (weatherSheet[stemOf(name)]) {
    const spec = weatherSheet[stemOf(name)];
    const meta = await sharp(buf).metadata();
    const fw = Math.floor((meta.width ?? spec.n * spec.w) / spec.n);
    const fh = meta.height ?? spec.h;
    const frames = [];
    for (let i = 0; i < spec.n; i++) {
      const raw = await sharp(buf).extract({ left: i * fw, top: 0, width: fw, height: fh }).png().toBuffer();
      frames.push(await place(await trim(raw), spec.w, spec.h, spec.place));
    }
    await sharp({ create: { width: spec.w * spec.n, height: spec.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(frames.map((f, i) => ({ input: f, left: i * spec.w, top: 0 })))
      .webp({ quality: 90 })
      .toFile(`public/assets/weather/${stemOf(name)}.webp`);
    done.push(`${name} → public/assets/weather/ (${spec.w * spec.n}×${spec.h}，${spec.n} 帧)`);
    return;
  }
  // 6f) 可选 UI 图标（彩色 + 单色）
  if (/^ui-/.test(stemOf(name)) && (/^(ui-speed|ui-pause|ui-fullscreen)(-mono)?$/.test(stemOf(name)))) {
    const placed = await place(await trim(buf), 512, 512, "center");
    await sharp(placed).webp({ quality: 92 }).toFile(`public/assets/icons/${stemOf(name)}.webp`);
    done.push(`${name} → public/assets/icons/ (512×512)`);
    return;
  }
  // 6) Token
  if (stemOf(name) === "token-sun" || stemOf(name) === "token-coin") {
    const placed = await place(await trim(buf), 96, 96, "center");
    await sharp(placed).webp({ quality: 92 }).toFile(`public/assets/tokens/${stemOf(name)}.webp`);
    done.push(`${name} → public/assets/tokens/ (96×96)`);
    return;
  }
  // 7) 表现插图：128×128 居中，强制左上角透明
  const roster = "pea icepea spore needle homing cabbage kernel butter melon winter star fire cob basketball snowball sun coin shield magnet crack iceblock sleep splash dust impact bloom wind ring".split(" ");
  if (roster.includes(stemOf(name))) {
    // crack 是"叠在植物身上的受损层"，按需求书规格收进画布 85%，
    // 否则会盖过植物轮廓（其余图标填满整格）。
    const inner = stemOf(name) === "crack" ? 108 : 128;
    const placed = inner === 128
      ? await place(await trim(buf), 128, 128, "center")
      : await place(await trim(buf), inner, inner, "center").then((b) =>
          sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite([{ input: b, left: 10, top: 10 }])
            .png()
            .toBuffer(),
        );
    const { data, info } = await sharp(placed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // 贴边裁掉 1px，保证“左上角全透明”的资源契约
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++)
        if (x === 0 || y === 0 || x === 127 || y === 127) data[(y * 128 + x) * info.channels + 3] = 0;
    await sharp(data, { raw: { width: 128, height: 128, channels: info.channels } })
      .webp({ lossless: true })
      .toFile(`public/assets/presentation/${stemOf(name)}.webp`);
    done.push(`${name} → public/assets/presentation/ (128×128)`);
    return;
  }
  skipped.push(name);
}

await mkdir(IN, { recursive: true });
if (!existsSync(IN)) {
  console.log(`请把 AI 出图放进 ${IN}，文件名见 docs/redraw-brief.md`);
  process.exit(0);
}
const files = (await readdir(IN)).filter((f) => /\.(png|webp|jpg|jpeg)$/i.test(f));
if (!files.length) {
  console.log(`${IN} 里还没有图片。文件名与要求见 docs/redraw-brief.md`);
  process.exit(0);
}
for (const f of files) await importFile(f);
console.log("== 重绘导入完成 ==");
for (const line of done) console.log("  ✓ " + line);
if (skipped.length) console.log("  ⚠ 未识别的文件名（已跳过）: " + skipped.join(", "));
if (done.some((d) => d.includes("assets-source"))) console.log("  提示：底图已更新，接着跑 `npm run assets:portraits` 让游戏使用新底图。");
