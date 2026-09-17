import { describe, it, expect } from "vitest";
import sharp from "sharp";

/**
 * 道具贴图的资源契约。这些贴图替代了原先的代码绘制（小推车、地形、水面、token），
 * 一旦缺文件、尺寸或透明通道不对，游戏里就会出现空白或错位，因此在这里锁死。
 */
const files = import.meta.glob("../public/assets/{terrain,water,tokens}/*.{webp,png}");

const meta = (path: string) => sharp(`public/assets/${path}`).metadata();

describe("道具贴图资源契约", () => {
  it("小推车精灵表为 512×96、4 帧 × 128×96（触地线 89/96）", async () => {
    const m = await meta("mower.png");
    expect(m.width).toBe(512);
    expect(m.height).toBe(96);
    expect((m.width ?? 0) / 128).toBe(4);
    expect(m.hasAlpha).toBe(true);
  });

  it("地形与 token 贴图存在、尺寸正确且带透明通道", async () => {
    const expected: [string, number, number][] = [
      ["terrain/grave.webp", 120, 140],
      ["terrain/vase.webp", 110, 120],
      ["terrain/ice.webp", 120, 90],
      ["terrain/crater.webp", 120, 80],
      ["tokens/token-sun.webp", 96, 96],
      ["tokens/token-coin.webp", 96, 96],
    ];
    for (const [path, w, h] of expected) {
      expect(files[`../public/assets/${path}`], `${path} 缺失`).toBeTruthy();
      const m = await meta(path);
      expect([m.width, m.height], path).toEqual([w, h]);
      expect(m.hasAlpha, `${path} 需要透明通道`).toBe(true);
      expect(m.channels, `${path} 需要 RGBA`).toBe(4);
    }
  });

  it("水面贴图为可平铺的整幅尺寸，且内容半透明（不遮死背景美术）", async () => {
    const strip = await meta("water/water-strip.webp");
    expect([strip.width, strip.height]).toEqual([891, 168]);
    expect(strip.hasAlpha).toBe(true);
    const ripple = await meta("water/water-ripple.webp");
    expect([ripple.width, ripple.height]).toEqual([512, 128]);
    expect(ripple.hasAlpha).toBe(true);
    // 水面叠加层必须整体半透明，否则会把泳池美术盖住
    const { data, info } = await sharp("public/assets/water/water-strip.webp")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let max = 0;
    for (let i = 3; i < data.length; i += info.channels) max = Math.max(max, data[i]);
    expect(max).toBeLessThan(230);
    expect(max).toBeGreaterThan(10);
  });

  it("表现插图保持 128×128 透明契约（描边处理不得丢 alpha）", async () => {
    const shots = import.meta.glob("../public/assets/presentation/*.webp");
    const keys = Object.keys(shots).filter((k) => !k.endsWith("manifest.json"));
    expect(keys.length).toBe(28);
    for (const key of keys.slice(0, 6)) {
      const path = key.replace("../public/assets/", "");
      const m = await meta(path);
      expect([m.width, m.height], path).toEqual([128, 128]);
      expect(m.hasAlpha, `${path} 丢了透明通道`).toBe(true);
    }
  });
});
