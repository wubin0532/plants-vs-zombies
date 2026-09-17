import { describe, it, expect } from "vitest";
import sharp from "sharp";
// @ts-ignore 脚本侧模块没有类型声明
import { labelComponents, claimsFor } from "../scripts/lib/sprite-segmentation.mjs";
// @ts-ignore 源图可能是 png/webp，统一按扩展名解析
import { sourcePath, sourcePathOrThrow } from "../scripts/lib/assets.mjs";
import { spriteScaleCorrection } from "../src/game/sprite-scale.generated";

/** 立绘文件是否存在，交给 Vite 的 glob 解析，避免引入 Node 类型依赖。 */
const portraitFiles = import.meta.glob("../public/assets/portraits/*.webp");

const plantIds =
  "pea sunflower cherry wallnut potato snowpea chomper repeater puff sunshroom fume grave hypno scaredy ice doom lily squash three kelp jalapeno spike torch tallnut sea lantern cactus blover split star pumpkin magnet cabbage pot kernel coffee garlic umbrella marigold melon gatling twin gloom cattail winter goldmagnet spikerock cob imitater".split(
    " ",
  );
const zombieIds =
  "basic flag cone pole bucket paper screen football dancer backup ducky snorkel zomboni bobsled dolphin jack balloon digger pogo yeti bungee catapult garg imp boss ladder".split(
    " ",
  );

async function contentBox(file: string) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 32) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  return {
    left: minX,
    top: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    canvasW: info.width,
    canvasH: info.height,
  };
}

const newReport = () => ({ splits: [] as string[], splitComps: new Set<number>() });

// assets-source/ 是按 .gitignore 仅保留在本地的素材；仓库里没有时跳过切图用例，
// 否则新克隆 / CI 会因为找不到源图集而失败（其余立绘契约测试仍然有效）。
const hasSheets = !!sourcePath("assets-source/plants") && !!sourcePath("assets-source/zombies");
const describeSheets = hasSheets ? describe : describe.skip;

describeSheets("精灵图集切图", () => {
  it("植物：49 个精灵各自独占一个连通域，没有任何一个被格线切断", async () => {
    const { W, H, comps } = await labelComponents(sourcePathOrThrow("assets-source/plants"));
    const report = newReport();
    const { claims, compOwner } = claimsFor(comps, 7, 7, plantIds.length, W, H, report);
    expect(comps.length).toBe(plantIds.length);
    expect(report.splits.length).toBe(0);
    expect(compOwner.size).toBe(comps.length);
    const claimed = claims.map((pixels: number[]) => new Set(pixels));
    for (const [comp, ci] of compOwner as Map<number, number>) {
      expect(ci).toBeLessThan(plantIds.length);
      const set = claimed[ci];
      // 关键不变量：连通域的每一个像素都必须落在它归属的精灵里 —— 被切开即为回归
      const missing = comps[comp].pixels.filter((p: number) => !set.has(p)).length;
      expect(missing).toBe(0);
    }
    for (const pixels of claims) expect(pixels.length).toBeGreaterThan(0);
  });

  it("僵尸：仅有 boss/pogo 一处粘连，被最小割拆成两个完整个体", async () => {
    const { W, H, comps } = await labelComponents(sourcePathOrThrow("assets-source/zombies"));
    const report = newReport();
    const { claims } = claimsFor(comps, 6, 5, zombieIds.length, W, H, report);
    expect(comps.length).toBe(25);
    expect(report.splits.length).toBe(1);
    expect(zombieIds.length).toBe(26);
    for (const pixels of claims) expect(pixels.length).toBeGreaterThan(0);
    for (const id of ["pogo", "boss"]) {
      const pixels = claims[zombieIds.indexOf(id)] as number[];
      const ys = pixels.map((p) => Math.floor(p / W));
      expect(Math.max(...ys) - Math.min(...ys) + 1).toBeGreaterThan(120);
    }
  });

  it("全部立绘存在、画布尺寸正确、内容不贴边", async () => {
    const sets = [
      [plantIds, "p-", 160, 160],
      [zombieIds, "z-", 160, 200],
    ] as const;
    for (const [ids, prefix, w, h] of sets) {
      for (const id of ids) {
        const file = `../public/assets/portraits/${prefix}${id}.webp`;
        expect(portraitFiles[file], `${file} 缺失`).toBeTruthy();
        const box = await contentBox(`public/assets/portraits/${prefix}${id}.webp`);
        expect([box.canvasW, box.canvasH]).toEqual([w, h]);
        expect(box.left).toBeGreaterThanOrEqual(4);
        expect(box.top).toBeGreaterThanOrEqual(4);
        expect(w - (box.left + box.w)).toBeGreaterThanOrEqual(4);
        expect(h - (box.top + box.h)).toBeGreaterThanOrEqual(4);
        expect(box.w).toBeGreaterThan(8);
        expect(box.h).toBeGreaterThan(8);
      }
    }
  });

  it("显示补偿表覆盖全部立绘且取值在合理区间", () => {
    const keys = [
      ...plantIds.map((i) => "p-" + i),
      ...zombieIds.map((i) => "z-" + i),
    ];
    const table = spriteScaleCorrection as Record<string, number>;
    for (const key of keys) {
      const value = table[key];
      expect(typeof value, `${key} 缺少补偿`).toBe("number");
      expect(value).toBeGreaterThanOrEqual(0.6);
      expect(value).toBeLessThanOrEqual(1.8);
    }
    expect(Object.keys(table).length).toBe(keys.length);
  });
});
