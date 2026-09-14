import { it, expect } from "vitest";
import sharp from "sharp";
import { motionSheet } from "../src/game/animation";

for (const [id, count] of [["basic", 16], ["cone", 16], ["bucket", 16], ["garg", 16], ["pole", 24], ["chomper", 16]] as const) {
  it(`${id} 动作图集每帧非空、边界透明，脚底对齐`, async () => {
    const path = `public/assets/animation/${id}.webp`;
    const { frameWidth: w, frameHeight: h } = id === "chomper"
      ? { frameWidth: 256, frameHeight: 256 } : motionSheet(id);
    const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(info.width).toBe(w * 4);
    expect(info.height).toBe(h * count / 4);
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
      expect(solid, `frame ${f}`).toBeGreaterThan(500);
      expect(edge, `frame ${f}`).toBe(0);
      expect(bottom, `frame ${f}`).toBeGreaterThanOrEqual(h - 12);
      expect(bottom, `frame ${f}`).toBeLessThan(h - 6);
    }
  });
}
