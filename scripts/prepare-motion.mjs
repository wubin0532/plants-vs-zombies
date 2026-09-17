import sharp from "sharp";
import { sourcePathOrThrow } from "./lib/assets.mjs";
import { mkdir } from "node:fs/promises";
// Ignore disconnected alpha specks when finding the character bounds.
async function characterCrop(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info,
    visited = new Uint8Array(width * height);
  let best = [];
  for (let start = 0; start < width * height; start++) {
    if (visited[start] || data[start * 4 + 3] < 64) continue;
    const queue = [start];
    visited[start] = 1;
    for (let n = 0; n < queue.length; n++) {
      const index = queue[n],
        x = index % width,
        y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy,
            j = ny * width + nx;
          if (
            nx < 0 ||
            ny < 0 ||
            nx >= width ||
            ny >= height ||
            visited[j] ||
            data[j * 4 + 3] < 64
          )
            continue;
          visited[j] = 1;
          queue.push(j);
        }
    }
    if (queue.length > best.length) best = queue;
  }
  if (best.length < 500) throw new Error("Missing character in animation cell");
  let left = width,
    top = height,
    right = 0,
    bottom = 0;
  for (const index of best) {
    const x = index % width,
      y = Math.floor(index / width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  left = Math.max(0, left - 1);
  top = Math.max(0, top - 1);
  right = Math.min(width - 1, right + 1);
  bottom = Math.min(height - 1, bottom + 1);
  return sharp(buffer)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
}
// One atlas-wide scale preserves pose proportions; never independently scale each frame.
const specifications = {
  basic: { targetHeight: 176, rows: 4, width: 192, height: 256, standing: 12 },
  cone: { targetHeight: 224, rows: 4, width: 192, height: 256, standing: 12 },
  bucket: { targetHeight: 202, rows: 4, width: 192, height: 256, standing: 12 },
  garg: { targetHeight: 192, rows: 4, width: 320, height: 320, standing: 8 },
  pole: { targetHeight: 250, rows: 6, width: 320, height: 320, standing: 8 },
  chomper: { targetHeight: 210, rows: 4, width: 256, height: 256, standing: 4 },
};
await mkdir("public/assets/animation", { recursive: true });
for (const [id, spec] of Object.entries(specifications)) {
  const {
    targetHeight,
    rows,
    width: frameWidth,
    height: frameHeight,
    standing,
  } = spec;
  const count = rows * 4;
  const source = sourcePathOrThrow(`assets-source/${id === "chomper" ? "plant" : "zombie"}-${id}-motion`);
  const meta = await sharp(source).metadata();
  if (!meta.hasAlpha)
    throw new Error(`${id}: source must have real alpha transparency`);
  const alpha = (await sharp(source).stats()).channels[3];
  if (alpha.min !== 0 || alpha.max < 250 || alpha.mean > 245)
    throw new Error(`${id}: source background must contain transparent pixels`);
  const crops = [];
  for (let i = 0; i < count; i++) {
    const left = Math.round(((i % 4) * meta.width) / 4),
      top = Math.round((Math.floor(i / 4) * meta.height) / rows);
    const width = Math.round((((i % 4) + 1) * meta.width) / 4) - left,
      height = Math.round(((Math.floor(i / 4) + 1) * meta.height) / rows) - top;
    const crop = await sharp(source)
      .extract({ left, top, width, height })
      .png()
      .toBuffer();
    const trimmed = await characterCrop(crop);
    crops.push({ buffer: trimmed, meta: await sharp(trimmed).metadata() });
  }
  const standingHeights = crops
    .slice(0, standing)
    .map((c) => c.meta.height)
    .sort((a, b) => a - b);
  const factor = Math.min(
    targetHeight / standingHeights[Math.floor(standing / 2)],
    (frameWidth - 12) / Math.max(...crops.map((c) => c.meta.width)),
    (frameHeight - 16) / Math.max(...crops.map((c) => c.meta.height)),
  );
  const cells = [];
  for (let i = 0; i < count; i++) {
    const crop = crops[i],
      width = Math.round(crop.meta.width * factor),
      height = Math.round(crop.meta.height * factor);
    const frame = await sharp(crop.buffer)
      .resize(width, height)
      .png()
      .toBuffer();
    cells.push({
      input: frame,
      left: (i % 4) * frameWidth + Math.round((frameWidth - width) / 2),
      top: Math.floor(i / 4) * frameHeight + frameHeight - 7 - height,
    });
  }
  await sharp({
    create: {
      width: frameWidth * 4,
      height: frameHeight * rows,
      channels: 4,
      background: "#00000000",
    },
  })
    .composite(cells)
    .webp({ quality: 80 })
    .toFile(`public/assets/animation/${id}.webp`);
  console.log(`${id}: ${count} frames; uniform scale ${factor.toFixed(3)}`);
}
