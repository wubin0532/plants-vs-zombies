import { it, expect } from "vitest";
import sharp from "sharp";
import { motionSheet } from "../src/game/animation";
import { motionZombieFrames, motionPlantFrames } from "../src/game/motion-manifest.generated";

type Case = { id: string; count: number; w: number; h: number };
const zombies: Case[] = [
  { id: "basic", count: 16, w: 192, h: 256 },
  { id: "cone", count: 16, w: 192, h: 256 },
  { id: "bucket", count: 16, w: 192, h: 256 },
  { id: "garg", count: 16, w: 320, h: 320 },
  { id: "pole", count: 24, w: 320, h: 320 },
  ...Object.entries(motionZombieFrames).map(([id, count]) => {
    const { frameWidth: w, frameHeight: h } = motionSheet(id);
    return { id, count, w, h };
  }),
];
const plants: Case[] = [
  { id: "chomper", count: 16, w: 256, h: 256 },
  ...Object.entries(motionPlantFrames).map(([id, count]) => ({ id, count, w: 256, h: 256 })),
];

for (const { id, count, w, h } of [...zombies, ...plants]) {
  it(`${id} 动作图集每帧非空、边界透明，脚底对齐`, async () => {
    const path = `public/assets/animation/${id}.webp`;
    const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(info.width).toBe(w * 4);
    expect(info.height).toBe((h * count) / 4);
    for (let f = 0; f < count; f++) {
      let solid = 0, bottom = 0, edge = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const alpha = data[((Math.floor(f / 4) * h + y) * info.width + (f % 4) * w + x) * 4 + 3];
        if (alpha > 64) {
          solid++;
          bottom = Math.max(bottom, y);
          if (x === 0 || x === w - 1 || y === 0 || y === h - 1) edge++;
        }
      }
      expect(solid, `${id} frame ${f}`).toBeGreaterThan(500);
      expect(edge, `${id} frame ${f}`).toBe(0);
      expect(bottom, `${id} frame ${f}`).toBeGreaterThanOrEqual(h - 12);
      expect(bottom, `${id} frame ${f}`).toBeLessThan(h - 6);
    }
  });
}

// 真动作图集必须真的有姿势变化：相邻帧在可见像素上要有明显差异。
for (const { id, count, w, h } of [...zombies, ...plants]) {
  it(`${id} 相邻帧姿势有可见差异`, async () => {
    const path = `public/assets/animation/${id}.webp`;
    const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
    const frame = (f: number) => {
      const out = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const src = (((Math.floor(f / 4) * h + y) * info.width) + (f % 4) * w + x) * 4;
          const dst = (y * w + x) * 4;
          out[dst] = data[src]; out[dst + 1] = data[src + 1];
          out[dst + 2] = data[src + 2]; out[dst + 3] = data[src + 3];
        }
      return out;
    };
    const diffs: number[] = [];
    let prev = frame(0);
    for (let f = 1; f < count; f++) {
      const cur = frame(f);
      let sum = 0, asum = 0, n = 0;
      for (let i = 0; i < w * h * 4; i += 4) {
        const a = prev[i + 3], b = cur[i + 3];
        if (a > 32 || b > 32) {
          sum += Math.abs(prev[i] - cur[i]) + Math.abs(prev[i + 1] - cur[i + 1]) + Math.abs(prev[i + 2] - cur[i + 2]);
          asum += Math.abs(a - b);
          n++;
        }
      }
      diffs.push((sum / 3 + asum) / Math.max(1, n) / 255);
      prev = cur;
    }
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    expect(mean, `${id} mean frame diff`).toBeGreaterThan(0.03);
  });
}
