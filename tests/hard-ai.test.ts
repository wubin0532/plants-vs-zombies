import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { laneStrength } from "../src/game/director";

/** 暴露私有导演状态，仅用于困难模式战术的回归断言。 */
const lanes = (e: Engine) =>
  (e as unknown as { assaultLanes: Map<number, number> }).assaultLanes;

describe("困难模式智能攻击", () => {
  it("只有困难难度开启智能战术", () => {
    expect(new Engine(8, [], 1, { difficulty: "hard" }).smartAttack).toBe(true);
    expect(new Engine(8, [], 1).smartAttack).toBe(false);
    expect(new Engine(8, [], 1, { difficulty: "casual" }).smartAttack).toBe(false);
    expect(new Engine(8, [], 1, { difficulty: "custom" }).smartAttack).toBe(false);
  });

  it("割草机让所在行在导演眼里更“硬”", () => {
    expect(laneStrength([], [], 0)).toBe(0);
    expect(laneStrength([], [], 0, true)).toBe(8);
  });

  it("投石车在困难模式优先拆威胁最高的目标，普通模式仍打第一株", () => {
    const hard = new Engine(11, [], 1, { difficulty: "hard" });
    const nut = hard.addPlant("wallnut", 0, 4);
    const melon = hard.addPlant("melon", 0, 6);
    hard.spawn("catapult", 0, 8);
    hard.updateZombie(hard.zombies[0], 0.1);
    expect(melon.hp, "困难：高威胁目标被拆").toBe(melon.max - 100);
    expect(nut.hp, "困难：坚果没有被浪费火力").toBe(nut.max);

    const std = new Engine(11, [], 1);
    const nut2 = std.addPlant("wallnut", 0, 4);
    const melon2 = std.addPlant("melon", 0, 6);
    std.spawn("catapult", 0, 8);
    std.updateZombie(std.zombies[0], 0.1);
    expect(nut2.hp, "普通：仍打该行第一株").toBe(nut2.max - 100);
    expect(melon2.hp).toBe(melon2.max);
  });

  it("蹦极在困难模式直接落在威胁最高的主植物格", () => {
    const e = new Engine(11, [], 1, { difficulty: "hard" });
    const nut = e.addPlant("wallnut", 0, 2);
    const melon = e.addPlant("melon", 3, 5);
    e.spawn("bungee");
    const z = e.zombies[0];
    expect([z.row, z.x]).toEqual([3, 5]);
    z.age = 6;
    e.updateZombie(z, 0.1);
    expect(e.plants).not.toContain(melon);
    expect(e.plants).toContain(nut);
  });

  it("困难模式的蹦极与投石车会跳过保护伞罩住的植物", () => {
    const e = new Engine(11, [], 1, { difficulty: "hard" });
    const melon = e.addPlant("melon", 0, 4);
    e.addPlant("umbrella", 0, 4);
    const pea = e.addPlant("pea", 0, 6);
    e.spawn("catapult", 0, 8);
    e.updateZombie(e.zombies[0], 0.1);
    expect(melon.hp).toBe(melon.max);
    expect(pea.hp).toBe(pea.max - 100);

    const b = new Engine(11, [], 1, { difficulty: "hard" });
    const guarded = b.addPlant("melon", 0, 4);
    b.addPlant("umbrella", 0, 4);
    const open = b.addPlant("pea", 2, 6);
    b.spawn("bungee");
    expect([b.zombies[0].row, b.zombies[0].x]).toEqual([2, 6]);
    expect(b.plants).toContain(guarded);
    expect(b.plants).toContain(open);
  });

  it("困难模式每波都重算主攻行，普通模式只在旗波前", () => {
    const hard = new Engine(8, [], 42, { difficulty: "hard" });
    hard.composeWave(1);
    expect(lanes(hard).get(2), "困难：第 2 波就有主攻行").toBeTypeOf("number");
    const std = new Engine(8, [], 42);
    std.composeWave(1);
    expect(lanes(std).get(2), "普通：第 2 波不提前选行").toBeUndefined();
  });

  it("困难模式主攻行承受显著更多兵力", () => {
    const concentration = (difficulty: "hard" | "standard") => {
      const e = new Engine(8, [], 42, { difficulty });
      for (const r of [0, 1, 3, 4]) {
        for (let c = 0; c < 4; c++) e.addPlant("pea", r, c);
        e.addPlant("wallnut", r, 5);
      }
      e.composeWave(1); // 困难模式会为第 2 波选定主攻行
      e.wave = 2;
      const target = lanes(e).get(2);
      let hit = 0;
      const N = 800;
      for (let i = 0; i < N; i++) {
        e.spawn("basic");
        if (target !== undefined && e.zombies.at(-1)!.row === target) hit++;
        e.zombies.pop();
      }
      return { target, share: hit / N };
    };
    const hard = concentration("hard");
    const std = concentration("standard");
    expect(hard.target).toBeTypeOf("number");
    expect(std.target).toBeUndefined();
    expect(hard.share, "困难集火占比").toBeGreaterThan(0.75);
  });

  it("困难模式优先集火没有割草机的弱行", () => {
    const e = new Engine(8, [], 42, { difficulty: "hard" });
    // 第 4 行没有植物但有一台割草机；第 2 行既没有植物也没有割草机 → 更该被打。
    e.mowers[4] = true;
    e.mowers[2] = false;
    e.composeWave(1);
    expect(lanes(e).get(2)).toBe(2);
  });

  it("困难模式玩偶匣走向植物最密集的一行", () => {
    const e = new Engine(11, [], 1, { difficulty: "hard" });
    for (let c = 2; c < 6; c++) e.addPlant("pea", 3, c); // 第 3 行最密
    e.addPlant("pea", 0, 2);
    e.spawn("jack");
    expect(e.zombies[0].row).toBe(3);
  });

  it("困难模式的撑杆被高坚果挡住时绕行一次，之后改为啃食", () => {
    const e = new Engine(11, [], 1, { difficulty: "hard" });
    const nut = e.addPlant("tallnut", 0, 4);
    e.spawn("pole", 0, 4.2);
    const z = e.zombies[0];
    e.updateZombie(z, 0.1);
    expect(z.row).toBe(1);
    expect(z.detoured).toBe(true);
    expect(nut.hp, "绕行时不啃原坚果").toBe(nut.max);
    // 同一只僵尸第二次遇到坚果不再绕行
    const nut2 = e.addPlant("tallnut", 1, 4);
    z.timer = 0;
    e.updateZombie(z, 0.1);
    expect(z.row).toBe(1);
    expect(nut2.hp).toBe(nut2.max - 100);
  });

  it("困难模式绕行不会进入水路", () => {
    const e = new Engine(21, [], 1, { difficulty: "hard" }); // 2、3 行是水
    e.addPlant("tallnut", 2, 4);
    e.spawn("pole", 2, 4.2);
    e.updateZombie(e.zombies[0], 0.1);
    expect(e.zombies[0].row, "只能绕到第 1 行旱路").toBe(1);
  });

  it("普通模式的撑杆仍然啃食高坚果，不绕行", () => {
    const e = new Engine(11, [], 1);
    const nut = e.addPlant("tallnut", 0, 4);
    e.spawn("pole", 0, 4.2);
    e.updateZombie(e.zombies[0], 0.1);
    expect(e.zombies[0].row).toBe(0);
    expect(e.zombies[0].detoured).toBeUndefined();
    expect(nut.hp).toBe(nut.max - 100);
  });
});
