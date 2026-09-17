import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";

function step(e: Engine, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.step(1 / 60);
}

/** 白天泳池关卡（2/3 行水路）。 */
const pool = () => new Engine(21, []);
const cell = (e: Engine, row: number, col: number) =>
  e.plants.filter((p) => p.row === row && p.col === col);

describe("铲除带植物底座的二次确认", () => {
  it("首次铲带植物的睡莲不执行，只提示", () => {
    const e = pool();
    e.addPlant("lily", 2, 0);
    e.addPlant("pea", 2, 0);
    e.shovel(2, 0);
    expect(cell(e, 2, 0)).toHaveLength(2);
    expect(e.message).toContain("睡莲");
    expect(e.message).toContain("整格移除");
    expect(e.messageTone).toBe("alert");
  });

  it("3 秒确认窗口内再铲同格，整格移除", () => {
    const e = pool();
    e.addPlant("lily", 2, 0);
    e.addPlant("pea", 2, 0);
    e.shovel(2, 0);
    step(e, 1.5);
    e.shovel(2, 0);
    expect(cell(e, 2, 0)).toHaveLength(0);
  });

  it("窗口过期后需要重新确认", () => {
    const e = pool();
    e.addPlant("lily", 2, 0);
    e.addPlant("pea", 2, 0);
    e.shovel(2, 0);
    step(e, 3.5); // 超过 3 秒窗口
    e.shovel(2, 0);
    expect(cell(e, 2, 0)).toHaveLength(2); // 再次拒绝
    e.shovel(2, 0); // 新窗口内确认
    expect(cell(e, 2, 0)).toHaveLength(0);
  });

  it("铲其它格子会重置确认窗口", () => {
    const e = pool();
    e.addPlant("lily", 2, 0);
    e.addPlant("pea", 2, 0);
    e.addPlant("lily", 2, 1);
    e.addPlant("pea", 2, 1);
    e.shovel(2, 0); // 窗口开在 (2,0)
    e.shovel(2, 1); // 换格：视为首次，拒绝并重开窗口
    expect(cell(e, 2, 0)).toHaveLength(2);
    expect(cell(e, 2, 1)).toHaveLength(2);
  });

  it("无植物的底座与空格行为不变，屋顶花盆同样适用", () => {
    const e = pool();
    e.addPlant("lily", 2, 0);
    e.shovel(2, 0); // 空睡莲：立即移除
    expect(cell(e, 2, 0)).toHaveLength(0);
    e.shovel(1, 0); // 空格：什么都不发生
    expect(e.plants).toHaveLength(0);

    const roof = new Engine(41, []); // 屋顶前 3 列自带花盆
    roof.addPlant("cabbage", 0, 0);
    expect(roof.at(0, 0, "base")?.id).toBe("pot");
    roof.shovel(0, 0);
    expect(cell(roof, 0, 0)).toHaveLength(2); // 首次拒绝
    expect(roof.message).toContain("花盆");
    roof.shovel(0, 0);
    expect(cell(roof, 0, 0)).toHaveLength(0);
  });

  it("普通草坪（无底座）铲除行为不变", () => {
    const e = new Engine(1, []);
    e.addPlant("pea", 0, 0);
    e.addPlant("pumpkin", 0, 0);
    e.shovel(0, 0); // 先铲南瓜头
    expect(cell(e, 0, 0).map((p) => p.id)).toEqual(["pea"]);
    e.shovel(0, 0); // 再铲豌豆
    expect(cell(e, 0, 0)).toHaveLength(0);
  });
});
