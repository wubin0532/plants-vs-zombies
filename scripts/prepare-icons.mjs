import sharp from "sharp";
import { mkdir } from "node:fs/promises";

// 用 160x160 的豌豆肖像生成 PWA / 主屏幕图标，背景为庭院绿径向渐变。
const source = "public/assets/portraits/p-pea.webp";
const outDir = "public/icons";

const bgSvg = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      '<defs><radialGradient id="g" cx="50%" cy="36%" r="78%">' +
      '<stop offset="0%" stop-color="#548f4b"/>' +
      '<stop offset="58%" stop-color="#2f5c38"/>' +
      '<stop offset="100%" stop-color="#17301f"/>' +
      "</radialGradient></defs>" +
      `<rect width="${size}" height="${size}" fill="url(#g)"/></svg>`,
  );

async function icon(size, file) {
  const inset = Math.round(size * 0.14);
  const art = await sharp(source)
    .resize(size - inset * 2, size - inset * 2, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  await sharp(bgSvg(size))
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toFile(`${outDir}/${file}`);
}

await mkdir(outDir, { recursive: true });
await icon(192, "icon-192.png");
await icon(512, "icon-512.png");
await icon(180, "apple-touch-icon.png");
console.log("icons written to", outDir);
