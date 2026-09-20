/**
 * 资产对齐与贴图质检。
 *
 * 检查项（都是"看着没错但会错位"的地方）：
 *   立绘    —— 脚底是否落在格心（水平偏移）、内容是否贴边、画布尺寸
 *   小推车  —— 4 帧的内容包围盒是否一致（不一致会抖动）、触地线是否在 89/96
 *   地形    —— 水平居中度、底边是否贴在预期基线
 *   token   —— 居中度
 *   水面    —— 透明度上限、上下是否渐隐、是否覆盖游戏水路
 *   背景    —— 草坪 y/x 是否落在 116-620 / 210-1101，迷雾水带是否落在 284-452
 *   云雾    —— 左右/上下边缘连续性（平铺接缝）
 *   插图    —— 居中度、左上角透明、互不重复
 *
 * 用法：node scripts/verify-assets.mjs
 */
import sharp from "sharp";
import { existsSync, readdirSync } from "node:fs";

const LOGICAL = { w: 1200, h: 690, lawnL: 210, lawnR: 1101, lawnT: 116, lawnB: 620, waterT: 284, waterB: 452 };
const issues = [];
const notes = [];
const flag = (msg) => issues.push(msg);
// 严格模式把"提示"也视为失败；CI 可用 ASSETS_STRICT=1 或 --strict 开启。
const STRICT = process.env.ASSETS_STRICT === "1" || process.argv.includes("--strict");
const note = (msg) => (STRICT ? issues.push(msg) : notes.push(msg));

/** 读原始 RGBA */
async function raw(path) {
  return sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/** 内容包围盒 + 脚底中心（底部 15% 的行内，不透明像素的平均 x） */
function analyze(data, info) {
  const { width: W, height: H, channels: C } = info;
  let minX = W, minY = H, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] <= 24) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  if (!count) return null;
  const bandTop = maxY - Math.max(1, Math.round((maxY - minY + 1) * 0.15));
  let sumX = 0, n = 0;
  for (let y = bandTop; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++)
      if (data[(y * W + x) * C + 3] > 96) {
        sumX += x;
        n++;
      }
  return {
    minX, maxX, minY, maxY, count,
    w: maxX - minX + 1, h: maxY - minY + 1,
    cx: (minX + maxX) / 2,
    footX: n ? sumX / n : (minX + maxX) / 2,
    fill: count / (W * H),
  };
}

const portraitIds = {
  plants: "pea sunflower cherry wallnut potato snowpea chomper repeater puff sunshroom fume grave hypno scaredy ice doom lily squash three kelp jalapeno spike torch tallnut sea lantern cactus blover split star pumpkin magnet cabbage pot kernel coffee garlic umbrella marigold melon gatling twin gloom cattail winter goldmagnet spikerock cob imitater".split(" "),
  zombies: "basic flag cone pole bucket paper screen football dancer backup ducky snorkel zomboni bobsled dolphin jack balloon digger pogo yeti bungee catapult garg imp boss ladder".split(" "),
};

/* ------------------------------- 1. 立绘 -------------------------------- */
console.log("== 立绘（脚底是否落在格心）==");
for (const [kind, ids] of Object.entries(portraitIds)) {
  const prefix = kind === "plants" ? "p-" : "z-";
  const expect = kind === "plants" ? [160, 160] : [160, 200];
  const offs = [];
  for (const id of ids) {
    const path = `public/assets/portraits/${prefix}${id}.webp`;
    if (!existsSync(path)) { flag(`立绘缺失 ${path}`); continue; }
    const { data, info } = await raw(path);
    if (info.width !== expect[0] || info.height !== expect[1])
      flag(`${prefix}${id} 画布尺寸 ${info.width}x${info.height}，应为 ${expect[0]}x${expect[1]}`);
    const a = analyze(data, info);
    if (!a) { flag(`${prefix}${id} 全透明（空图）`); continue; }
    const footOff = a.footX - info.width / 2;      // 脚底相对画布中心的偏移
    const bottomGap = info.height - 1 - a.maxY;     // 内容底距画布底
    if (Math.abs(footOff) > 8) offs.push(`${id} ${footOff > 0 ? "+" : ""}${footOff.toFixed(0)}px`);
    // 偏移过大属于明确的锚点错误，任何模式都直接判定失败。
    if (Math.abs(footOff) > 40) flag(`${prefix}${id} 脚底偏离画布中心 ${footOff.toFixed(0)}px，超出可用范围`);
    if (bottomGap > 12) flag(`${prefix}${id} 内容未贴底（底部空隙 ${bottomGap}px，会整体上浮）`);
    if (a.minX <= 1 || a.maxX >= info.width - 2 || a.minY <= 1)
      flag(`${prefix}${id} 内容贴到画布边缘（可能被裁切）`);
  }
  console.log(`  ${kind}: ${ids.length} 张，脚底偏移 >8px 的 ${offs.length} 张`);
  if (offs.length) console.log(`    ${offs.join("、")}`);
  if (offs.length > 3) note(`${kind} 有 ${offs.length} 张立绘脚底偏离格心，建议加水平锚点补偿`);
}

/* ------------------------------ 2. 小推车 ------------------------------- */
console.log("\n== 小推车（4 帧一致性与触地线）==");
{
  const path = "public/assets/mower.png";
  const { data, info } = await raw(path);
  if (info.width !== 512 || info.height !== 96) flag(`mower.png 应为 512x96，实际 ${info.width}x${info.height}`);
  const boxes = [];
  for (let f = 0; f < 4; f++) {
    const sub = Buffer.alloc(128 * 96 * 4);
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 128; x++) {
        const s = (y * info.width + x + f * 128) * info.channels, d = (y * 128 + x) * 4;
        sub[d] = data[s]; sub[d + 1] = data[s + 1]; sub[d + 2] = data[s + 2]; sub[d + 3] = data[s + 3];
      }
    const a = analyze(sub, { width: 128, height: 96, channels: 4 });
    if (!a) { flag(`mower 第 ${f + 1} 帧为空`); continue; }
    boxes.push(a);
    console.log(`  帧${f + 1}: 内容 ${a.w}x${a.h} 底边 y=${a.maxY} 中心 x=${a.cx.toFixed(1)}`);
    if (Math.abs(a.maxY - 89) > 3) flag(`mower 帧${f + 1} 触地线在 y=${a.maxY}，应为 89（车会浮空或陷地）`);
  }
  if (boxes.length === 4) {
    const ws = boxes.map((b) => b.w), hs = boxes.map((b) => b.h), cxs = boxes.map((b) => b.cx);
    const spread = (arr) => Math.max(...arr) - Math.min(...arr);
    if (spread(ws) > 6 || spread(hs) > 6)
      flag(`mower 4 帧尺寸不一致（宽差 ${spread(ws)}px、高差 ${spread(hs)}px）→ 跑动时会抖动`);
    if (spread(cxs) > 4) flag(`mower 4 帧水平位置不一致（差 ${spread(cxs).toFixed(1)}px）→ 跑动时会横跳`);
  }
}

/* ------------------------------- 3. 地形 -------------------------------- */
console.log("\n== 地形（居中与底边）==");
{
  const spec = {
    grave: [120, 140, -26], vase: [110, 120, -20], ice: [120, 90, 20], crater: [120, 80, 16],
  };
  for (const [id, [w, h, offsetY]] of Object.entries(spec)) {
    const path = `public/assets/terrain/${id}.webp`;
    if (!existsSync(path)) { flag(`地形缺失 ${path}`); continue; }
    const { data, info } = await raw(path);
    const a = analyze(data, info);
    if (info.width !== w || info.height !== h) flag(`${id} 尺寸 ${info.width}x${info.height}，应为 ${w}x${h}`);
    if (!a) { flag(`${id} 为空图`); continue; }
    const cxOff = a.cx - info.width / 2;
    // 内容底边在画布内的位置 → 换算成格心偏移（画布中心放在 y+offsetY）
    // stamp 以画布中心放在 y+offsetY，内容底边相对格心 = offsetY + (画布高/2 - 底部空隙)
    const contentBottomInCell = offsetY + (info.height / 2 - (info.height - 1 - a.maxY));
    console.log(`  ${id.padEnd(6)} 内容 ${a.w}x${a.h} 中心偏移 ${cxOff.toFixed(1)}px 底边位于格心下方 ${contentBottomInCell}px`);
    if (Math.abs(cxOff) > 6) flag(`${id} 水平偏离画布中心 ${cxOff.toFixed(1)}px → 在格子里会歪`);
    if (contentBottomInCell < 10 || contentBottomInCell > 60)
      flag(`${id} 底边距格心 ${contentBottomInCell}px，超出合理范围（10~60）`);
  }
}

/* ------------------------------ 4. token -------------------------------- */
console.log("\n== Token（居中度）==");
for (const id of ["token-sun", "token-coin"]) {
  const path = `public/assets/tokens/${id}.webp`;
  if (!existsSync(path)) { flag(`token 缺失 ${path}`); continue; }
  const { data, info } = await raw(path);
  const a = analyze(data, info);
  if (!a) { flag(`${id} 为空图`); continue; }
  const dx = a.cx - info.width / 2, dy = (a.minY + a.maxY) / 2 - info.height / 2;
  console.log(`  ${id.padEnd(11)} 内容 ${a.w}x${a.h} 偏移 x${dx.toFixed(1)} y${dy.toFixed(1)}`);
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) flag(`${id} 未居中（x${dx.toFixed(1)} y${dy.toFixed(1)}）`);
}

/* ------------------------------- 5. 水面 -------------------------------- */
console.log("\n== 水面 ==");
{
  const p = "public/assets/water/water-strip.webp";
  const { data, info } = await raw(p);
  let maxA = 0;
  const rowA = [];
  for (let y = 0; y < info.height; y++) {
    let sum = 0;
    for (let x = 0; x < info.width; x++) sum += data[(y * info.width + x) * info.channels + 3];
    const avg = sum / info.width;
    rowA.push(avg);
    maxA = Math.max(maxA, avg);
  }
  const edge = (rowA[0] + rowA[info.height - 1]) / 2, mid = rowA[Math.floor(info.height / 2)];
  console.log(`  水带 ${info.width}x${info.height} 最大行均 alpha ${maxA.toFixed(0)} 中间 ${mid.toFixed(0)} 边缘 ${edge.toFixed(0)}`);
  if (maxA > 230) flag("water-strip 太不透明（会盖住背景泳池美术）");
  if (edge > mid * 0.4) flag("water-strip 上下边缘没有渐隐（会出现硬边）");
  const rp = "public/assets/water/water-ripple.webp";
  if (existsSync(rp)) {
    const { info: ri } = await raw(rp);
    console.log(`  波纹 ${ri.width}x${ri.height}`);
    if (ri.width !== 512 || ri.height !== 128) flag(`water-ripple 尺寸 ${ri.width}x${ri.height}，应为 512x128`);
  }
}

/* -------------------------- 5b. 天气 / 水帧 ----------------------------- */
{
  const p = "public/assets/weather/rain-streak.webp";
  if (!existsSync(p)) flag(`天气贴图缺失 ${p}`);
  else {
    const { info } = await raw(p);
    console.log(`  雨幕 ${info.width}x${info.height}`);
    if (info.width !== 256 || info.height !== 256)
      flag(`rain-streak 尺寸 ${info.width}x${info.height}，应为 256x256`);
  }
  const wf = "public/assets/water/water-frames.webp";
  if (!existsSync(wf)) flag(`水面动画帧缺失 ${wf}`);
  else {
    const { info } = await raw(wf);
    console.log(`  水面动画 ${info.width}x${info.height}`);
    if (info.width !== 2048 || info.height !== 128)
      flag(`water-frames 尺寸 ${info.width}x${info.height}，应为 2048x128`);
  }
  const wsf = "public/assets/water/water-strip-frames.webp";
  if (!existsSync(wsf)) flag(`泳池底色帧缺失 ${wsf}`);
  else {
    const { info } = await raw(wsf);
    console.log(`  泳池底色帧 ${info.width}x${info.height}`);
    if (info.width !== 3564 || info.height !== 168)
      flag(`water-strip-frames 尺寸 ${info.width}x${info.height}，应为 3564x168`);
  }
  // 天气贴图：逐张存在性 + 关键精灵表尺寸
  const weatherSheets = { "rain-splash": [512, 128], "water-splash": [512, 128], "wind-leaves": [768, 128], "icon-weather": [640, 128] };
  const weatherSingles = ["heat-shimmer", "cloud-shadow", "frost", "water-caustics", "snow-tile", "blackout-glow", "sun-flare", "eclipse-mask"];
  let weatherCount = 0;
  for (const [n, [ew, eh]] of Object.entries(weatherSheets)) {
    const p2 = `public/assets/weather/${n}.webp`;
    if (!existsSync(p2)) { flag(`天气精灵表缺失 ${p2}`); continue; }
    const { info } = await raw(p2);
    weatherCount++;
    if (info.width !== ew || info.height !== eh) flag(`${n} 尺寸 ${info.width}x${info.height}，应为 ${ew}x${eh}`);
  }
  for (const n of weatherSingles) {
    const p2 = `public/assets/weather/${n}.webp`;
    if (!existsSync(p2)) flag(`天气贴图缺失 ${p2}`);
    else weatherCount++;
  }
  console.log(`  天气贴图 ${weatherCount}/${Object.keys(weatherSheets).length + weatherSingles.length} 张`);
}

/* ------------------------------- 6. 背景 -------------------------------- */
console.log("\n== 背景（草坪 / 水带对齐）==");
{
  // 白天美术的草偏亮、夜景美术偏暗青，单一阈值会被树篱/夜色带偏。
  // 做法：多套阈值各算候选带，再取"宽度最接近理论值"的那条。
  const grassTests = [
    (r, g, b) => g > r + 14 && g > b + 14 && g > 60,   // 亮色（白天/泳池）
    (r, g, b) => g > r + 12 && g > 55 && g < 160,       // 暗色（夜/雾）
  ];
  const waterTests = [
    (r, g, b) => b > 170 && b - r > 90,
    (r, g, b) => b > 150 && b - r > 70,
  ];
  const spanRows = (arr, th) => {
    const idx = arr.map((v, i) => (v > th ? i : -1)).filter((i) => i >= 0);
    return idx.length > 8 ? [idx[0], idx[idx.length - 1]] : null;
  };
  /** 水域取"最宽连续区间"：泳道分隔带会把水带切成两段 */
  const widestSpan = (arr, th, minRun = 5, maxGap = 22) => {
    const runs = []; let st = -1;
    for (let i = 0; i <= arr.length; i++) {
      const on = i < arr.length && arr[i] > th;
      if (on && st < 0) st = i;
      if (!on && st >= 0) { if (i - st >= minRun) runs.push([st, i - 1]); st = -1; }
    }
    if (!runs.length) return null;
    const merged = [runs[0].slice()];
    for (const r of runs.slice(1)) {
      const last = merged[merged.length - 1];
      if (r[0] - last[1] <= maxGap) last[1] = r[1]; else merged.push(r.slice());
    }
    return merged.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  };
  const pickClosest = (cands, target) => {
    const ok = cands.filter(Boolean);
    if (!ok.length) return null;
    return ok.sort((a, b) => Math.abs((a[1] - a[0]) - target) - Math.abs((b[1] - b[0]) - target))[0];
  };

  for (const name of ["day", "night", "fog", "pool", "roof"]) {
    const path = `public/assets/backgrounds/${name}.webp`;
    if (!existsSync(path)) { flag(`背景缺失 ${path}`); continue; }
    const { data, info } = await raw(path);
    const C = info.channels, W = info.width, H = info.height;
    const kx = LOGICAL.w / W, ky = LOGICAL.h / H;
    const roofLike = name === "roof"; // 屋顶关没有草坪，不做草坪判定

    const rowGrass = grassTests.map(() => []);
    const rowWater = waterTests.map(() => []);
    const colGrass = grassTests.map(() => []);
    const wN = Math.round((W * 0.9175 - W * 0.175) / 2);
    for (let y = 0; y < H; y++) {
      const gc = grassTests.map(() => 0), wc = waterTests.map(() => 0);
      let n = 0;
      for (let x = Math.floor(W * 0.25); x < W * 0.8; x++) {
        const o = (y * W + x) * C; n++;
        grassTests.forEach((t, i) => { if (t(data[o], data[o + 1], data[o + 2])) gc[i]++; });
      }
      for (let x = Math.floor(W * 0.175); x < W * 0.9175; x += 2) {
        const o = (y * W + x) * C;
        waterTests.forEach((t, i) => { if (t(data[o], data[o + 1], data[o + 2])) wc[i]++; });
      }
      gc.forEach((c, i) => rowGrass[i].push(c / n));
      wc.forEach((c, i) => rowWater[i].push(c / wN));
    }
    for (let x = 0; x < W; x++) {
      const gc = grassTests.map(() => 0);
      let n = 0;
      for (let y = Math.floor(H * 0.2); y < H * 0.88; y += 2) {
        const o = (y * W + x) * C; n++;
        grassTests.forEach((t, i) => { if (t(data[o], data[o + 1], data[o + 2])) gc[i]++; });
      }
      gc.forEach((c, i) => colGrass[i].push(c / n));
    }

    const lawnPx = (LOGICAL.lawnB - LOGICAL.lawnT) / ky;
    const lawnPxW = (LOGICAL.lawnR - LOGICAL.lawnL) / kx;
    const waterPx = (LOGICAL.waterB - LOGICAL.waterT) / ky;
    const grassY = pickClosest(rowGrass.map((r) => spanRows(r, 0.45)), lawnPx);
    const grassX = pickClosest(colGrass.map((r) => spanRows(r, 0.35)), lawnPxW);
    // 泳道分隔带约 13px：minRun 8 可滤掉池边高光条，maxGap 25 又能把上下半池并回一条
    const waterY = pickClosest(rowWater.map((r) => widestSpan(r, 0.6, 8, 25)), waterPx);

    // 仅对"由本流水线校准过"的底图做强校验；day/pool/roof 是项目原始美术，
    // 颜色启发式在这些画面上不可靠（树冠会判成草），只作参考输出。
    // 只对 fog 做强校验；night 由 import-redraw 的 calibrateNight() 分段拉伸精确对齐，
    // 夜色太暗导致颜色启发式不可靠，因此仅作参考输出。
    const calibrated = name === "fog";
    const fmt = (s, k) => (s ? `${(s[0] * k).toFixed(0)}-${(s[1] * k).toFixed(0)}` : "未检出");
    console.log(
      `  ${name.padEnd(6)} ${calibrated ? "[强校验]" : "[参考]  "} 草坪 y ${fmt(grassY, ky)}（目标 116-620） x ${fmt(grassX, kx)}（目标 210-1101）` +
        (waterY ? ` 水带 y ${fmt(waterY, ky)}（目标 284-452）` : ""),
    );
    if (grassY && !roofLike && calibrated) {
      const [gt, gb] = [grassY[0] * ky, grassY[1] * ky];
      if (Math.abs(gt - LOGICAL.lawnT) > 16 || Math.abs(gb - LOGICAL.lawnB) > 16)
        flag(`${name} 草坪纵向 ${gt.toFixed(0)}-${gb.toFixed(0)}，偏离目标 116-620（>16px）`);
    }
    // 横向用"网格边缘是否落在土路/暖色路面"来判断，比"绿色占比"稳健得多
    // （夜景美术的草是暗青色，纯绿判据会误判）。
    if (!roofLike) {
      const pathLike = (r, g, b) => r > g + 10; // 土路/花坛是暖色，草是冷绿
      for (const lx of [LOGICAL.lawnL + 1, LOGICAL.lawnR - 1]) {
        let path = 0, total = 0;
        for (let ly = LOGICAL.lawnT + 6; ly < LOGICAL.lawnB - 6; ly += 4) {
          // 跳过水路行：泳池压边是米色，会被误判成土路
          if (ly > LOGICAL.waterT - 10 && ly < LOGICAL.waterB + 10) continue;
          const x = Math.round(lx * kx), y = Math.round(ly * ky);
          const o = (y * W + x) * C;
          total++;
          if (pathLike(data[o], data[o + 1], data[o + 2])) path++;
        }
        if (path / total > 0.2)
          flag(`${name} 网格 x=${lx} 这一列有 ${(path / total * 100).toFixed(0)}% 落在土路/暖色上（网格可能超出草坪）`);
      }
    }
    if (waterY && calibrated) {
      const [wt, wb] = [waterY[0] * ky, waterY[1] * ky];
      if (Math.abs(wt - LOGICAL.waterT) > 14 || Math.abs(wb - LOGICAL.waterB) > 14)
        flag(`${name} 水带 ${wt.toFixed(0)}-${wb.toFixed(0)}，偏离目标 284-452（>14px）`);
    }
    // 水面横向必须落在可玩水路内，否则割草机/睡莲会站到水上（这次踩过的坑）
    if (waterY && calibrated) {
      const y0 = Math.round(waterY[0] + 6), y1 = Math.round(waterY[1] - 6);
      let wl = -1, wr = -1;
      for (let x = 0; x < W; x++) {
        let hit = 0, n = 0;
        for (let y = y0; y < y1; y += 4) { const o = (y * W + x) * C; n++; if (waterTests[0](data[o], data[o + 1], data[o + 2])) hit++; }
        if (hit / n > 0.5) { if (wl < 0) wl = x; wr = x; }
      }
      if (wl >= 0) {
        const [gl, gr] = [wl * kx, wr * kx];
        if (gl < LOGICAL.lawnL - 24 || gr > LOGICAL.lawnR + 24)
          flag(`${name} 水面横向 ${gl.toFixed(0)}-${gr.toFixed(0)} 超出可玩水路 210-1101（割草机/睡莲会站到水上）`);
      }
    }
  }
}


/* ------------------------------- 7. 云雾 -------------------------------- */
console.log("\n== 云雾（平铺接缝）==");
for (const name of ["mist-a", "mist-b", "mist-c", "overcast-cloud"]) {
  const path = `public/assets/mist/${name}.webp`;
  const { data, info } = await raw(path);
  const C = info.channels, W = info.width, H = info.height;
  let lr = 0, tb = 0;
  for (let y = 0; y < H; y++) lr += Math.abs(data[(y * W) * C + 3] - data[(y * W + W - 1) * C + 3]);
  for (let x = 0; x < W; x++) tb += Math.abs(data[x * C + 3] - data[((H - 1) * W + x) * C + 3]);
  // 竖条纹检测：软透明贴图若被"按行摊 RGB 差值"处理过，会出现彩色竖条（曾踩过）
  const colMean = [];
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let y = 0; y < H; y++) { const o = (y * W + x) * C; r += data[o]; g += data[o + 1]; b += data[o + 2]; }
    colMean.push([r / H, g / H, b / H]);
  }
  let devSum = 0, maxDev = 0, bad = 0;
  for (let x = 1; x < W - 1; x++) {
    const d = [0, 1, 2].reduce((t, c) => t + Math.abs(colMean[x][c] - (colMean[x - 1][c] + colMean[x + 1][c]) / 2), 0) / 3;
    devSum += d; maxDev = Math.max(maxDev, d); if (d > 6) bad++;
  }
  console.log(`  ${name} 左右边缘 alpha 平均差 ${(lr / H).toFixed(1)} 上下 ${(tb / W).toFixed(1)}｜竖条纹 均值 ${(devSum / (W - 2)).toFixed(2)} 超标列 ${bad}`);
  if (lr / H > 12) flag(`${name} 左右边缘差异 ${(lr / H).toFixed(1)}，平铺可能有竖缝`);
  if (tb / W > 12) flag(`${name} 上下边缘差异 ${(tb / W).toFixed(1)}，平铺可能有横缝`);
  if (bad > Math.max(8, W * 0.02)) flag(`${name} 有 ${bad} 列竖条纹（彩色条纹，多半是处理时把 RGB 差值摊平了）`);
}

/* ----------------------------- 8. 表现插图 ------------------------------ */
console.log("\n== 表现插图（居中 / 透明 / 唯一性）==");
{
  const roster = "pea icepea spore needle homing cabbage kernel butter melon winter star fire cob basketball snowball sun coin shield magnet crack iceblock sleep splash dust impact bloom wind ring".split(" ");
  const hashes = new Map();
  let offCount = 0, dupCount = 0;
  for (const id of roster) {
    const path = `public/assets/presentation/${id}.webp`;
    if (!existsSync(path)) { flag(`插图缺失 ${path}`); continue; }
    const { data, info } = await raw(path);
    if (info.width !== 128 || info.height !== 128) flag(`${id} 尺寸 ${info.width}x${info.height}，应为 128x128`);
    if (data[3] !== 0) flag(`${id} 左上角不是全透明（契约要求）`);
    const a = analyze(data, info);
    if (!a) { flag(`${id} 为空图`); continue; }
    const dx = a.cx - 64, dy = (a.minY + a.maxY) / 2 - 64;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { offCount++; notes.push(`插图 ${id} 偏移 x${dx.toFixed(0)} y${dy.toFixed(0)}`); }
    const key = a.w + "x" + a.h + ":" + a.count;
    if (hashes.has(key)) { dupCount++; flag(`插图 ${id} 与 ${hashes.get(key)} 内容疑似重复`); } else hashes.set(key, id);
  }
  console.log(`  28 张，居中偏差 >8px 的 ${offCount} 张，疑似重复 ${dupCount} 组`);
}

/* ------------------------------- 9. VFX --------------------------------- */
console.log("\n== VFX / 动画图集 ==");
{
  const fx = readdirSync("public/assets/fx").filter((f) => f.endsWith(".webp"));
  const sizes = new Set();
  for (const f of fx) {
    const m = await sharp(`public/assets/fx/${f}`).metadata();
    sizes.add(`${m.width}x${m.height}`);
  }
  console.log(`  fx ${fx.length} 张，尺寸种类 ${[...sizes].join(" / ")}`);
  if (fx.length !== 16) flag(`fx 应为 16 帧，实际 ${fx.length}`);
  for (const f of readdirSync("public/assets/animation").filter((f) => f.endsWith(".webp"))) {
    const m = await sharp(`public/assets/animation/${f}`).metadata();
    if (!m.hasAlpha) flag(`动画图集 ${f} 丢了透明通道`);
  }
  console.log(`  动画图集 ${readdirSync("public/assets/animation").filter((f) => f.endsWith(".webp")).length} 个`);
}

/* -------------------------------- 汇总 --------------------------------- */
console.log("\n============================ 质检结果 ============================");
if (!issues.length) {
  console.log(
    notes.length
      ? `✅ 未发现阻断性问题（另有 ${notes.length} 条提示，可用 ASSETS_STRICT=1 视为失败）`
      : "✅ 未发现对齐/贴图问题",
  );
} else {
  console.log(`⚠ 发现 ${issues.length} 处问题：`);
  for (const i of issues) console.log("  · " + i);
}
if (notes.length) {
  console.log(`\n提示（未达报警阈值，但值得留意 ${notes.length} 条）：`);
  for (const n of notes.slice(0, 12)) console.log("  - " + n);
  if (notes.length > 12) console.log(`  ...以及另外 ${notes.length - 12} 条`);
}
// 有阻断性问题（或严格模式下的提示）时以非零码退出，让 CI/构建能真正拦截。
process.exitCode = issues.length ? 1 : 0;
