import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";

function step(e: Engine, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.step(1 / 60);
}

/** 步进直到条件满足或超时，返回条件是否达成。 */
function until(e: Engine, seconds: number, done: () => boolean) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    if (done()) return true;
    e.step(1 / 60);
  }
  return done();
}

describe("土豆地雷触发", () => {
  it("武装完成后，走近的僵尸触发爆炸并被消灭（复现：触发半径曾小于啃食起手距离）", () => {
    const e = new Engine(1, []);
    const mine = e.addPlant("potato", 0, 3);
    mine.age = 15; // 已过 14 秒武装时间
    e.spawn("basic", 0, 4.2);
    const z = e.zombies.at(-1)!;
    let boom = false;
    const exploded = until(e, 30, () => {
      if (e.effects.some((f) => f.type === "boom" && f.source === "potato"))
        boom = true;
      return !e.plants.includes(mine);
    });
    expect(exploded).toBe(true);
    expect(boom).toBe(true);
    expect(z.hp).toBeLessThanOrEqual(0);
    expect(z.action).not.toBe("eat"); // 不是被吃掉的
  });

  it("未武装的地雷不爆炸，会被僵尸吃掉", () => {
    const e = new Engine(1, []);
    const mine = e.addPlant("potato", 0, 3);
    e.spawn("basic", 0, 3.6);
    const z = e.zombies.at(-1)!;
    step(e, 8);
    expect(e.plants.includes(mine)).toBe(false); // 300 血被啃光
    expect(z.hp).toBeGreaterThan(0);
    expect(e.effects.every((f) => f.source !== "potato")).toBe(true);
  });

  it("爆炸只覆盖本行小范围，相邻行僵尸不受伤害", () => {
    const e = new Engine(1, []);
    const mine = e.addPlant("potato", 0, 3);
    mine.age = 15;
    e.spawn("basic", 0, 4.2);
    e.spawn("basic", 1, 4.2);
    const neighbor = e.zombies[1];
    until(e, 30, () => !e.plants.includes(mine));
    expect(e.plants.includes(mine)).toBe(false);
    expect(neighbor.hp).toBe(neighbor.max);
  });

  it("飞行与地下单位不触发地雷", () => {
    const e = new Engine(1, []);
    const mine = e.addPlant("potato", 0, 3);
    mine.age = 15;
    e.spawn("balloon", 0, 4.2);
    const z = e.zombies.at(-1)!;
    step(e, 25);
    expect(z.x).toBeLessThan(2.5); // 气球直接飞过地雷所在格
    expect(e.plants.includes(mine)).toBe(true);
  });

  it("模仿者复制的地雷走同一触发路径", () => {
    const e = new Engine(1, ["imitater"]);
    e.imitate = "potato";
    e.sun = 100;
    expect(e.plant("imitater", 0, 3)).toBe(true);
    const mine = e.at(0, 3)!;
    expect(mine.id).toBe("potato");
    mine.age = 15;
    e.spawn("basic", 0, 4.2);
    const z = e.zombies.at(-1)!;
    const exploded = until(e, 30, () => !e.plants.includes(mine));
    expect(exploded).toBe(true);
    expect(z.hp).toBeLessThanOrEqual(0);
  });
});
