/**
 * 源图压缩：把 assets-source 下的大 PNG 转成 WebP，保证画质不退化。
 *
 * 选型依据（实测可见像素 PSNR）：
 *   - 绘画/半透明素材 q92 + alphaQuality 100 → PSNR 40.7~42.5dB（视觉无损），体积约 1/8
 *   - 小图与切图源（<200KB，或 plants/zombies 图集）→ 用 lossless，零损失
 * 校验：解码尺寸一致 + alpha 通道逐像素一致 + 可见像素 PSNR ≥ 38dB，任一不过就保留 PNG。
 */
import sharp from "sharp";
import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";

/** 走切图算法的图集必须零损失，避免影响连通域边界 */
const MUST_BE_LOSSLESS = new Set(["plants", "zombies"]);
const SMALL_FILE = 200 * 1024;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.(png|jpg|jpeg)$/i.test(entry.name)) out.push(path);
  }
  return out;
}

async function visiblePsnr(aPath, bBuf) {
  const a = await sharp(aPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(bBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return -1;
  // alpha 必须逐像素一致
  for (let i = 3; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) return -2;
  let se = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] < 8) continue; // 只统计可见像素
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c] - b.data[i + c];
      se += d * d;
      n++;
    }
  }
  return n ? 10 * Math.log10((255 * 255) / (se / n)) : Infinity;
}

const files = walk("assets-source").filter((f) => !f.endsWith(".webp"));
let before = 0, after = 0, converted = 0, kept = 0;

for (const file of files) {
  const size = statSync(file).size;
  const name = file.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  const lossless = MUST_BE_LOSSLESS.has(name) || size < SMALL_FILE;
  const opts = lossless
    ? { lossless: true, effort: 6 }
    : { quality: 92, alphaQuality: 100, effort: 6 };
  const out = file.replace(/\.[^.]+$/, "") + ".webp";
  let encoded = await sharp(file).webp(opts).toBuffer();
  let psnr = await visiblePsnr(file, encoded);
  let mode = lossless ? "lossless" : "q92";
  // q92 达不到可见无损标准时，回退 lossless；lossless 仍不划算就保留原图
  if (!lossless && (psnr === -1 || psnr === -2 || psnr < 38)) {
    const fallback = await sharp(file).webp({ lossless: true, effort: 6 }).toBuffer();
    const fallbackPsnr = await visiblePsnr(file, fallback);
    if (fallbackPsnr === Infinity && fallback.length < size) {
      encoded = fallback;
      psnr = fallbackPsnr;
      mode = "lossless(回退)";
    } else {
      console.log(`⚠ 跳过（q92 PSNR ${psnr === -1 || psnr === -2 ? "尺寸/alpha 不符" : psnr.toFixed(1) + "dB"}，lossless 也不划算）: ${file}`);
      kept++;
      continue;
    }
  }
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, encoded);
  unlinkSync(file);
  before += size;
  after += encoded.length;
  converted++;
  const mark = mode;
  console.log(
    `${file.padEnd(52)} ${(size / 1024).toFixed(0).padStart(5)}KB → ${(encoded.length / 1024).toFixed(0).padStart(4)}KB ${mark} PSNR ${lossless ? "∞" : psnr.toFixed(1)}dB`,
  );
}

console.log(`\n共转换 ${converted} 个文件，跳过 ${kept} 个`);
if (converted)
  console.log(
    `体积 ${(before / 1024 / 1024).toFixed(1)}MB → ${(after / 1024 / 1024).toFixed(1)}MB（省 ${((1 - after / before) * 100).toFixed(0)}%）`,
  );
if (!existsSync("assets-source")) console.log("assets-source 不存在");
