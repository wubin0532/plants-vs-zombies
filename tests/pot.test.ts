import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { plantById, plants, levels, recommendCards } from "../src/game/content";
import {
  POT_DISPLAY_SIZE,
  POT_LIFT,
  plantDisplaySize,
} from "../src/game/proportions";

describe("花盆按容器尺寸显示，盆栽植物抬到盆口", () => {
  it("只有花盆用容器尺寸，其余植物仍是 86", () => {
    expect(plantDisplaySize("pot")).toBe(POT_DISPLAY_SIZE);
    expect(POT_DISPLAY_SIZE).toBeGreaterThan(48);
    expect(POT_DISPLAY_SIZE).toBeLessThan(68);
    expect(plantDisplaySize("sunflower")).toBe(86);
    // 睡莲是平底，按原尺寸画在格子底部即可。
    expect(plantDisplaySize("lily")).toBe(86);
  });

  it("抬高质量 = 土面到贴底线的距离 × 显示比例（约 42px）", () => {
    expect(POT_LIFT).toBeGreaterThan(35);
    expect(POT_LIFT).toBeLessThan(50);
    expect(POT_LIFT).toBeCloseTo(((248 - 70) * POT_DISPLAY_SIZE) / 256, 6);
  });
});

describe("5-1 给花盆，5-2 给卷心菜投手", () => {
  it("解锁顺序对齐原版", () => {
    expect(plantById.pot.unlock).toBe(41);
    expect(plantById.cabbage.unlock).toBe(42);
  });

  it("5-1 能选到花盆，推荐阵容同时有底座与可用火力", () => {
    const unlocked = plants.filter((p) => p.unlock <= 41).map((p) => p.id);
    expect(unlocked).toContain("pot");
    expect(unlocked).not.toContain("cabbage");
    const rec = recommendCards(levels[40], unlocked, 6);
    expect(rec).toContain("pot");
    expect(
      rec.some((id) =>
        [
          "shooter",
          "shroom",
          "fume",
          "lob",
          "homing",
          "electric",
          "star",
        ].includes(plantById[id].kind),
      ),
    ).toBe(true);
  });

  it("5-1 的花盆能在屋顶落地，落地后即可种植物", () => {
    const e = new Engine(41, ["sunflower", "pot", "pea"]);
    e.sun = 500;
    expect(e.plant("pot", 0, 3)).toBe(true);
    expect(e.canPlant("pea", 0, 3)).toBe("");
    expect(e.plant("pea", 0, 3)).toBe(true);
  });

  it("花盆是屋顶专属：陆地/水路关卡都不能种（与每日卡池一致）", () => {
    const day = new Engine(1, ["pot"]);
    day.sun = 500;
    expect(day.canPlant("pot", 0, 0)).toBe("花盆只能种在屋顶");
    expect(day.plant("pot", 0, 0)).toBe(false);

    const pool = new Engine(21, ["pot"]);
    pool.sun = 500;
    expect(pool.canPlant("pot", 2, 0)).toBe("花盆只能种在屋顶");

    const roof = new Engine(41, ["pot"]);
    roof.sun = 500;
    expect(roof.canPlant("pot", 0, 5)).toBe("");
  });
});
