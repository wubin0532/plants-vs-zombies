/**
 * 天气与水面的占位美术生成器（可被 AI 出图直接替换同名文件）。
 *
 *   public/assets/weather/rain-streak.webp  256×256  可平铺斜雨
 *   public/assets/water/water-frames.webp   2048×128 4 帧 ×512×128 可平铺波纹
 *
 * 生成完全确定（不调用游戏随机数），AI 出图放入 assets-source/redraw/ 即可覆盖。
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const redraw = (name) => {
  const stem = name.replace(/\.[^.]+$/, "");
  return [".webp", ".png", ".jpg", ".jpeg"].some((e) => existsSync(`assets-source/redraw/${stem}${e}`));
};

/* --------------------------- 雨幕（可平铺） --------------------------- */
async function rainStreak() {
  const W = 256, H = 256;
  const buf = Buffer.alloc(W * H * 4);
  const put = (x, y, a) => {
    const xi = ((Math.round(x) % W) + W) % W;
    const yi = ((Math.round(y) % H) + H) % H;
    const o = (yi * W + xi) * 4;
    buf[o] = 190; buf[o + 1] = 220; buf[o + 2] = 245;
    buf[o + 3] = Math.min(255, buf[o + 3] + a);
  };
  for (let i = 0; i < 90; i++) {
    const x0 = (i * 97) % W, y0 = (i * 53) % H;
    const len = 34 + (i % 5) * 16, slant = -6 - (i % 3) * 3;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      put(x0 + slant * t, y0 + len * t, 72);
      put(x0 + slant * t - 1, y0 + len * t, 30);
    }
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 4 } })
    .webp({ quality: 88, effort: 5 })
    .toFile("public/assets/weather/rain-streak.webp");
  console.log("public/assets/weather/rain-streak.webp 256x256");
}

/* ----------------------- 泳池水面动画帧（可平铺） ---------------------- */
async function waterFrames() {
  const RW = 512, RH = 128, FRAMES = 4;
  const frameSvg = (f) => {
    const ripples = Array.from({ length: 22 }, (_, i) => {
      const x = (i * 97 + f * 24) % RW;
      const y = 10 + ((i * 37) % (RH - 20));
      const len = 60 + (i % 4) * 34;
      const path = (xx) =>
        `<path d="M${xx} ${y}q${len / 2}-5 ${len} 0" stroke="#eafcff" stroke-width="1.5" fill="none" opacity="${0.1 + (i % 3) * 0.05}"/>`;
      return path(x) + path(x - RW);
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${RW}" height="${RH}">${ripples}</svg>`;
  };
  const composites = [];
  for (let f = 0; f < FRAMES; f++) {
    const png = await sharp(Buffer.from(frameSvg(f))).png().toBuffer();
    composites.push({ input: png, left: f * RW, top: 0 });
  }
  await sharp({
    create: { width: RW * FRAMES, height: RH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .webp({ quality: 88, effort: 5 })
    .toFile("public/assets/water/water-frames.webp");
  console.log("public/assets/water/water-frames.webp 2048x128");
}

await mkdir("public/assets/weather", { recursive: true });
await mkdir("public/assets/water", { recursive: true });
if (redraw("rain-streak")) console.log("雨幕贴图: 已由 AI 重绘提供，跳过程序化生成");
else await rainStreak();
if (redraw("water-frames")) console.log("水面动画帧: 已由 AI 重绘提供，跳过程序化生成");
else await waterFrames();
