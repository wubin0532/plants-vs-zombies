/**
 * 生成可无缝平铺的云雾贴图（占位美术，可被 AI 出图直接替换同名文件）。
 *
 * 这些贴图是确定性程序化生成的占位资源：接入 AI 绘制版本时，只需用同名
 * 文件覆盖 public/assets/mist/mist-*.webp 即可，代码无需改动。
 * 生成方式：周期包裹的 value noise + fBm + 域扭曲 + billow 整形，
 * 保证上下左右无缝，随机数固定不参与游戏逻辑。
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
/** AI 重绘优先：见 scripts/prepare-props.mjs 的同名说明 */
const redraw = (name) => {
  const stem = name.replace(/\.[^.]+$/, "");
  return [".webp", ".png", ".jpg", ".jpeg"].some((e) => existsSync(`assets-source/redraw/${stem}${e}`));
};

const root = "public/assets/mist";
await mkdir(root, { recursive: true });

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

/** 固定整数哈希 -> [0,1)，与 fog-render 使用同一族常数，保证可复现。 */
const hash = (x, y) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** 周期 value noise：晶格在 px × py 处环绕，因此贴图天然可平铺。 */
function pnoise(x, y, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const wx = (i) => ((i % px) + px) % px;
  const wy = (j) => ((j % py) + py) % py;
  const a = hash(wx(xi), wy(yi)), b = hash(wx(xi + 1), wy(yi));
  const c = hash(wx(xi), wy(yi + 1)), d = hash(wx(xi + 1), wy(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** 分形叠加，每层晶格周期翻倍，保持无缝。 */
function fbm(x, y, base, octaves, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, freq = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(x * freq, y * freq, freq, freq / 2);
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

async function mist(file, w, h, opts) {
  const { scale, octaves, warp, threshold, softness, gamma, shade } = opts;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      // 域扭曲：让云团边缘卷曲、有翻滚感
      const wx = fbm(u, v, 3, 3) - 0.5;
      const wy = fbm(u + 0.37, v + 0.61, 3, 3) - 0.5;
      const su = u + wx * warp, sv = v + wy * warp;
      // billow 整形：|2n-1| 取反，形成棉絮状云核
      let n = 0, amp = 1, norm = 0;
      let freq = 2 * scale;
      for (let o = 0; o < octaves; o++) {
        const s = pnoise(su * freq, sv * freq, Math.round(freq), Math.round(freq / 2));
        n += amp * (1 - Math.abs(2 * s - 1));
        norm += amp;
        amp *= 0.52;
        freq *= 2;
      }
      n /= norm;
      // 软阈值：cores 不透明，边缘化为薄纱
      const bank = smooth(clamp01((n - threshold) / softness));
      const alpha = Math.pow(bank, gamma);
      // 体积感：云核略暗、边缘偏亮，带一点冷月色
      const lum = mix(1, 0.78, bank * shade);
      const o = (y * w + x) * 4;
      buf[o] = Math.round(255 * lum);
      buf[o + 1] = Math.round(255 * mix(1, 0.85, bank * shade));
      buf[o + 2] = Math.round(255 * mix(0.99, 0.87, bank * shade));
      buf[o + 3] = Math.round(255 * alpha);
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 88, effort: 5 })
    .toFile(`${root}/${file}`);
  console.log(`${root}/${file} ${w}x${h}`);
}

// 三层：大云bank / 中云团 / 细絮，供渲染层做视差叠加
const aiMist = redraw("mist-a") && redraw("mist-b") && redraw("mist-c");
if (aiMist) {
  console.log("云雾贴图: 已由 AI 重绘提供，跳过程序化生成");
} else {
  await mist("mist-a.webp", 1024, 512, { scale: 1.0, octaves: 5, warp: 0.09, threshold: 0.36, softness: 0.52, gamma: 1.25, shade: 0.55 });
  await mist("mist-b.webp", 1024, 512, { scale: 1.9, octaves: 4, warp: 0.13, threshold: 0.42, softness: 0.46, gamma: 1.1, shade: 0.4 });
  await mist("mist-c.webp", 1024, 512, { scale: 3.1, octaves: 3, warp: 0.07, threshold: 0.48, softness: 0.42, gamma: 1.0, shade: 0.25 });
}

/** 阴天云层：比迷雾更厚重，运行时叠加冷色 tint，AI 出图可覆盖。 */
if (redraw("overcast-cloud")) console.log("阴天云层: 已由 AI 重绘提供，跳过程序化生成");
else
  await mist("overcast-cloud.webp", 1024, 512, { scale: 1.0, octaves: 5, warp: 0, threshold: 0.3, softness: 0.5, gamma: 1.3, shade: 0.78 });

/** 路灯暖光贴图：径向衰减的暖色光晕，渲染层用 lighter 叠加。 */
if (redraw("glow-lantern")) console.log("路灯暖光: 已由 AI 重绘提供，跳过程序化生成");
else {
const glow = Buffer.alloc(256 * 256 * 4);
for (let y = 0; y < 256; y++)
  for (let x = 0; x < 256; x++) {
    const dx = (x - 128) / 128, dy = (y - 128) / 128;
    const d = clamp01(Math.sqrt(dx * dx + dy * dy));
    const a = Math.pow(1 - d, 2.6);
    const o = (y * 256 + x) * 4;
    glow[o] = 255;
    glow[o + 1] = 216;
    glow[o + 2] = 148;
    glow[o + 3] = Math.round(255 * a);
  }
await sharp(glow, { raw: { width: 256, height: 256, channels: 4 } })
  .webp({ quality: 90, effort: 5 })
  .toFile(`${root}/glow-lantern.webp`);
console.log(`${root}/glow-lantern.webp 256x256`);
}
