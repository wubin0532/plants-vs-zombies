import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";

/** 白天泳池关卡（2/3 行水路）。 */
const pool = () => new Engine(21, []);
const cell = (e: Engine, row: number, col: number) =>
  e.plants.filter((p) => p.row === row && p.col === col);

describe("铲子只铲最上层，底座（花盆/睡莲）留在原地", () => {
  it("睡莲上的植物被铲掉，睡莲留在原地", () => {
    const e = pool();
    e.addPlant("lily", 2, 0);
    e.addPlant("pea", 2, 0);
    e.shovel(2, 0);
    expect(cell(e, 2, 0).map((p) => p.id)).toEqual(["lily"]);
    expect(e.at(2, 0, "main")).toBeUndefined();
    // 不再有「3 秒内再铲一次将整格移除」的二次确认提示。
    expect(e.message).not.toContain("整格移除");
  });

  it("空睡莲再铲一次才移除", () => {
    const e = pool();
    e.addPlant("lily", 2, 0);
    e.addPlant("pea", 2, 0);
    e.shovel(2, 0); // 只铲豌豆
    e.shovel(2, 0); // 再铲空睡莲
    expect(cell(e, 2, 0)).toHaveLength(0);
  });

  it("屋顶预置花盆上的植物被铲掉，花盆留在原地", () => {
    const roof = new Engine(41, []); // 屋顶前 3 列自带花盆
    roof.addPlant("cabbage", 0, 0);
    expect(roof.at(0, 0, "base")?.id).toBe("pot");
    roof.shovel(0, 0);
    expect(cell(roof, 0, 0).map((p) => p.id)).toEqual(["pot"]);
    roof.shovel(0, 0);
    expect(cell(roof, 0, 0)).toHaveLength(0);
  });

  it("南瓜头 → 主植物 → 底座 依次铲除", () => {
    const e = pool();
    e.addPlant("lily", 2, 0);
    e.addPlant("pea", 2, 0);
    e.addPlant("pumpkin", 2, 0);
    e.shovel(2, 0); // 先铲南瓜头
    expect(cell(e, 2, 0).map((p) => p.id).sort()).toEqual(["lily", "pea"]);
    e.shovel(2, 0); // 再铲豌豆
    expect(cell(e, 2, 0).map((p) => p.id)).toEqual(["lily"]);
    e.shovel(2, 0); // 最后铲空睡莲
    expect(cell(e, 2, 0)).toHaveLength(0);
  });

  it("空格与无底座草坪行为不变，铲除不计入损失", () => {
    const e = new Engine(1, []);
    e.addPlant("pea", 0, 0);
    e.addPlant("pumpkin", 0, 0);
    e.shovel(0, 0); // 先铲南瓜头
    expect(cell(e, 0, 0).map((p) => p.id)).toEqual(["pea"]);
    e.shovel(0, 0); // 再铲豌豆
    expect(cell(e, 0, 0)).toHaveLength(0);
    e.shovel(0, 0); // 空格：什么都不发生
    expect(e.plants).toHaveLength(0);
    // 主动铲除不是损失，不应触发难度橡皮筋。
    expect(e.plantsLost).toBe(0);
    expect(e.message).not.toContain("整格移除");
  });
});
