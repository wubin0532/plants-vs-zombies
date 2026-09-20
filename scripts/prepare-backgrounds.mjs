/**
 * 生成两张夜战底图（结合本项目现有美术，风格与几何天然一致）：
 *   assets-source/fog.png   迷雾后院（由 pool.png 派生：夜色调 + 月光 + 雾带 + 暖窗光 + 水面反光）
 *   assets-source/night.png 月下墓园（由 day.png 派生：冷紫夜色 + 月光 + 雾带 + 墓碑剪影）
 *
 * 关键：泳池水线在生成阶段就对齐到游戏网格（第 3-4 行 → y 284-452 / 1200×690 空间），
 * 因此 src/game/scene-class.ts 里的运行时重映射 hack 可以删除。
 * 输出 2400×1380（1200×690 的 2 倍），由 prepare-assets 缩放到 1200×690。
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { sourcePathOrThrow } from "./lib/assets.mjs";
/** AI 重绘优先：见 scripts/prepare-props.mjs 的同名说明 */
const redraw = (name) => {
  const stem = name.replace(/\.[^.]+$/, "");
  return [".webp", ".png", ".jpg", ".jpeg"].some((e) => existsSync(`assets-source/redraw/${stem}${e}`));
};
// 逐张判断：某一张有 AI 出图就跳过它，没出的照常程序化生成。
const doFog = !redraw("fog");
const doNight = !redraw("night");
if (!doFog && !doNight) {
  console.log("夜战底图: 已由 AI 重绘提供，跳过程序化生成");
  process.exit(0);
}

await mkdir("assets-source", { recursive: true });
await mkdir("output/art-review", { recursive: true });

const W = 2400, H = 1380, S = 2; // S = 相对 1200×690 的倍率
const LAWN = { l: 210 * S, t: 116 * S, r: 1101 * S, b: 620 * S };
// 1200×690 空间里的三段落位（与 prepare-assets 的泳池对齐一致），×2 放大
const BANDS = [
  [116, 252, 116, 284],
  [252, 431, 284, 452],
  [431, 620, 452, 620],
].map(([f, t2, s2, e2]) => [f * S, t2 * S, s2 * S, e2 * S]);

const svgBuf = (svg, w = W, h = H) => sharp(Buffer.from(svg)).resize(w, h).png().toBuffer();
const blend = (input, blendMode, extra = {}) => ({ input, blend: blendMode, ...extra });

/** 冷色夜色：先整体压暗降饱和，再用蓝青罩色与顶光把画面拉成夜晚 */
async function nightGrade(base, opts) {
  const { topShade, midShade, cool, sat, bright } = opts;
  const graded = await sharp(base)
    .modulate({ brightness: bright, saturation: sat })
    .png()
    .toBuffer();
  const grad = await svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="${topShade}"/><stop offset=".45" stop-color="${midShade}"/>
      <stop offset="1" stop-color="${midShade}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
  const dark = await sharp(graded).composite([blend(grad, "multiply")]).png().toBuffer();
  const wash = await svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${cool}"/></svg>`);
  return sharp(dark).composite([blend(wash, "soft-light")]).png().toBuffer();
}

/** 月光：右上方向的一片冷光 + 轻微辉光 */
async function moonlight(base, strength) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><radialGradient id="m" cx="82%" cy="6%" r="85%">
      <stop offset="0" stop-color="#cfe4ff" stop-opacity="${strength}"/>
      <stop offset=".45" stop-color="#9dc0e8" stop-opacity="${strength * 0.45}"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#m)"/></svg>`;
  return sharp(base).composite([blend(await svgBuf(svg), "screen")]).png().toBuffer();
}

/** 单块云雾：椭圆羽化后叠加，避免出现矩形贴片边界 */
async function mistPatch(src, w, h, x, y, alpha) {
  const cw = Math.round(w), chh = Math.round(h);
  const tile = await sharp(src).resize(cw, chh, { fit: "fill" }).ensureAlpha().png().toBuffer();
  const mask = await svgBuf(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${chh}">
      <defs><radialGradient id="f" cx="50%" cy="50%" r="60%">
        <stop offset="0" stop-color="#fff" stop-opacity="1"/>
        <stop offset=".62" stop-color="#fff" stop-opacity=".72"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="${cw / 2}" cy="${chh / 2}" rx="${cw / 2}" ry="${chh / 2}" fill="url(#f)"/></svg>`,
    cw,
    chh,
  );
  const feathered = await sharp(tile).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return {
    input: await sharp(feathered).ensureAlpha().linear(alpha, 0).png().toBuffer(),
    left: Math.round(x),
    top: Math.round(y),
  };
}

/** 静态氛围雾带（用项目内的云雾贴图，保证与游戏内动态迷雾同一质感） */
async function mistBands(base, patches) {
  const layers = [];
  for (const [src, w, h, x, y, alpha] of patches)
    layers.push(await mistPatch(src, w, h, x, y, alpha));
  return sharp(base).composite(layers).png().toBuffer();
}

/** 房子窗户暖光：只落在房子一侧，模拟室内灯光透出 */
async function warmGlow(base, spots) {
  const circles = spots
    .map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#w)" opacity="${o}"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><radialGradient id="w"><stop offset="0" stop-color="#ffd79a" stop-opacity=".95"/>
      <stop offset=".5" stop-color="#ffb562" stop-opacity=".35"/>
      <stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient></defs>${circles}</svg>`;
  return sharp(base).composite([blend(await svgBuf(svg), "screen")]).png().toBuffer();
}

/** 右侧加深（迷雾关专用）：给动态迷雾留出层次，避免叠加后发白 */
async function rightShade(base, strength) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="0">
      <stop offset=".45" stop-color="#ffffff"/><stop offset="1" stop-color="${strength}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#r)"/></svg>`;
  return sharp(base).composite([blend(await svgBuf(svg), "multiply")]).png().toBuffer();
}

/** 暗角 */
async function vignette(base, opacity) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><radialGradient id="v" cx="50%" cy="52%" r="78%">
      <stop offset=".55" stop-color="#ffffff"/><stop offset="1" stop-color="#7d8ea6"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#v)" opacity="${opacity}"/></svg>`;
  return sharp(base).composite([blend(await svgBuf(svg), "multiply")]).png().toBuffer();
}

/** 把源图按泳池对齐规则重排，使水线精确落位；返回 2400×1380 缓冲 */
async function alignedBase(src, doAlign) {
  const resized = await sharp(src).resize(W, H, { fit: "fill" }).png().toBuffer();
  if (!doAlign) return resized;
  const pieces = [];
  for (const [from, to, start, end] of BANDS) {
    const input = await sharp(resized)
      .extract({ left: LAWN.l, top: from, width: LAWN.r - LAWN.l, height: to - from })
      .resize(LAWN.r - LAWN.l, end - start)
      .png()
      .toBuffer();
    pieces.push({ input, left: LAWN.l, top: start });
  }
  return sharp(resized).composite(pieces).png().toBuffer();
}

/* ------------------------------- 迷雾后院 ------------------------------- */
if (doFog) {
  let img = await alignedBase(sourcePathOrThrow("assets-source/pool"), true);
  img = await nightGrade(img, { topShade: "#5a6f8c", midShade: "#8b9cb4", cool: "#31506e", sat: 0.42, bright: 0.96 });
  img = await moonlight(img, 0.30);
  // 水面压色：夜景里池水必须比白天暗，否则和周围草地割裂
  const waterTame = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="wt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5d7d94" stop-opacity="0"/>
      <stop offset=".12" stop-color="#4f6d86" stop-opacity=".62"/>
      <stop offset=".88" stop-color="#4a6680" stop-opacity=".62"/>
      <stop offset="1" stop-color="#5d7d94" stop-opacity="0"/></linearGradient></defs>
    <rect x="${LAWN.l}" y="${568}" width="${LAWN.r - LAWN.l}" height="336" fill="url(#wt)"/></svg>`;
  img = await sharp(img).composite([blend(await svgBuf(waterTame), "multiply")]).png().toBuffer();
  // 水面月光反光：一条竖向柔光带，落在右侧水面
  const reflect = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="rf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dcecff" stop-opacity="0"/><stop offset=".35" stop-color="#cfe4ff" stop-opacity=".5"/>
      <stop offset="1" stop-color="#dcecff" stop-opacity="0"/></linearGradient>
      <linearGradient id="rh" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
      <mask id="rm"><rect x="${1500}" y="${568}" width="420" height="336" fill="url(#rh)"/></mask>
    </defs><rect x="${1500}" y="${568}" width="420" height="336" fill="url(#rf)" mask="url(#rm)"/></svg>`;
  img = await sharp(img).composite([blend(await svgBuf(reflect), "screen")]).png().toBuffer();
  img = await mistBands(img, [
    ["public/assets/mist/mist-b.webp", 2200, 620, 120, 200, 0.42],
    ["public/assets/mist/mist-a.webp", 1800, 520, 620, 96, 0.38],
    ["public/assets/mist/mist-c.webp", 1400, 380, 260, 700, 0.28],
    ["public/assets/mist/mist-b.webp", 1600, 420, 780, 820, 0.26],
    ["public/assets/mist/mist-c.webp", 1900, 460, 480, 1080, 0.22],
  ]);
  img = await warmGlow(img, [[110, 420, 190, 0.85], [120, 620, 150, 0.5], [70, 900, 160, 0.35]]);
  img = await rightShade(img, "#9fb0c2");
  img = await vignette(img, 0.55);
  await sharp(img).webp({ quality: 92, effort: 6 }).toFile("assets-source/fog.webp");
  await sharp(img).resize(1200, 690).png().toFile("output/art-review/preview-fog-bg.png");
  console.log("assets-source/fog.png");
}

/* ------------------------------- 月下墓园 ------------------------------- */
if (doNight) {
  let img = await alignedBase(sourcePathOrThrow("assets-source/day"), false);
  img = await nightGrade(img, { topShade: "#4b5a86", midShade: "#7f8bb0", cool: "#3a3468", sat: 0.5, bright: 0.95 });
  img = await moonlight(img, 0.34);
  // 草坪外围的墓碑剪影（不侵占可种植区 y 116-620）
  const stones = [
    [300, 1215, 78, 108], [470, 1245, 62, 86], [660, 1205, 96, 132], [880, 1240, 70, 96],
    [1160, 1210, 84, 116], [1420, 1245, 64, 88], [1680, 1215, 92, 124], [1960, 1240, 72, 100],
    [520, 62, 70, 96], [900, 70, 58, 80], [1360, 58, 76, 104], [1820, 66, 64, 88],
  ];
  const shapes = stones
    .map(([x, y, w, h]) => `<path d="M${x} ${y + h}V${y + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${y + h}Z" fill="#2b2f45" opacity=".92"/>
      <path d="M${x + w / 2 - 5} ${y + h - 16}v-26M${x + w / 2 - 16} ${y + h - 30}h32" stroke="#1b1f33" stroke-width="6" fill="none"/>`)
    .join("");
  const sil = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes}</svg>`;
  img = await sharp(img).composite([{ input: await svgBuf(sil) }]).png().toBuffer();
  img = await mistBands(img, [
    ["public/assets/mist/mist-a.webp", 2300, 640, 100, 160, 0.32],
    ["public/assets/mist/mist-b.webp", 1700, 460, 560, 760, 0.26],
    ["public/assets/mist/mist-c.webp", 1500, 400, 300, 60, 0.2],
  ]);
  img = await warmGlow(img, [[110, 420, 190, 0.8], [120, 620, 150, 0.45]]);
  // 萤火虫：草坪外围的微小暖光点
  const flies = Array.from({ length: 26 }, (_, i) => {
    const x = 260 + ((i * 331) % 1980), y = 40 + ((i * 197) % 1250);
    const r = 4 + (i % 3) * 2;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffef9f" opacity="${0.25 + (i % 4) * 0.12}"/>`;
  }).join("");
  img = await sharp(img)
    .composite([blend(await svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><radialGradient id="fg"><stop offset="0" stop-color="#fff6c4" stop-opacity=".9"/>
      <stop offset="1" stop-color="#ffd36a" stop-opacity="0"/></radialGradient></defs>${flies.replace(/fill="#ffef9f"/g, 'fill="url(#fg)"')}</svg>`), "screen")])
    .png()
    .toBuffer();
  img = await vignette(img, 0.6);
  await sharp(img).webp({ quality: 92, effort: 6 }).toFile("assets-source/night.webp");
  await sharp(img).resize(1200, 690).png().toFile("output/art-review/preview-night-bg.png");
  console.log("assets-source/night.png");
}
