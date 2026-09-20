/**
 * 立绘 / 卡片脚底水平锚点补偿表。
 *
 * verify-assets 会报“立绘脚底偏离画布中心”。这里测量每张 UI 实际显示的图片里
 * “脚底中心”相对画布中心的水平偏移（占画布宽度百分比），输出到
 * src/game/sprite-anchor.generated.ts；UI 用 transform: translateX(calc(var(--foot) * -1%))
 * 把角色水平回正。纯数值补偿，不改任何美术文件。
 *
 * 覆盖：public/assets/cards/p-*.webp（植物 UI 实际用卡片）+ public/assets/portraits/z-*.webp。
 */
import sharp from "sharp";
import { readdirSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

async function footOffsetPercent(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  let minX = W, maxX = -1, minY = H, maxY = -1, count = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] <= 24) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  if (!count) return 0;
  const bandTop = maxY - Math.max(1, Math.round((maxY - minY + 1) * 0.15));
  let sumX = 0, n = 0;
  for (let y = bandTop; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++)
      if (data[(y * W + x) * C + 3] > 96) { sumX += x; n++; }
  const footX = n ? sumX / n : (minX + maxX) / 2;
  return Math.round(((footX - W / 2) / W) * 1000) / 10;
}

const out = {};
for (const [dir, prefix] of [
  ["public/assets/cards", "p-"],
  ["public/assets/portraits", "z-"],
]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).sort()) {
    if (!/\.webp$/.test(f) || !f.startsWith(prefix)) continue;
    out[f.replace(/\.webp$/, "")] = await footOffsetPercent(`${dir}/${f}`);
  }
}
await writeFile(
  "src/game/sprite-anchor.generated.ts",
  "/** 由 scripts/prepare-anchors.mjs 生成，请勿手改。\n" +
    " * 脚底中心相对画布中心的水平偏移（占画布宽度百分比）；正数表示内容偏右，\n" +
    " * UI 用 transform: translateX(calc(var(--foot, 0) * -1%)) 回正。 */\n" +
    `export const spriteFootOffsetPct: Record<string, number> = ${JSON.stringify(out, null, 2)};\n`,
);
console.log(`锚点补偿表：${Object.keys(out).length} 项 → src/game/sprite-anchor.generated.ts`);
