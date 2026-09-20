import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// 默认用 160x160 的豌豆肖像 + 庭院绿径向渐变合成 PWA / 主屏幕图标。
// 若存在 AI 出的整幅 Logo（assets-source/redraw/app-logo.*），直接缩放覆盖。
const logo = [".webp", ".png", ".jpg", ".jpeg"]
  .map((e) => `assets-source/redraw/app-logo${e}`)
  .find(existsSync);
const source = logo ?? "public/assets/portraits/p-pea.webp";
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
  if (logo) {
    // AI Logo 视为整幅方图：cover 缩放，保证每个尺寸都满幅、无透明边。
    await sharp(source).resize(size, size, { fit: "cover" }).png().toFile(`${outDir}/${file}`);
    return;
  }
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
console.log(logo ? `icons written to ${outDir} (from ${logo})` : `icons written to ${outDir} (程序化豌豆版)`);
