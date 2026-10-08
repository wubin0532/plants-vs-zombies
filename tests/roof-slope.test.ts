import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { levels } from "../src/game/content";

/** 屋顶关（关卡 41 = 5-1，前 3 列自带花盆）。 */
const roof = (cards: string[] = []) => new Engine(41, cards);
const fire = (e: Engine, plant: { timer: number }) => {
  plant.timer = 0;
  e.step(0.1);
};

describe("屋顶斜坡挡直射", () => {
  it("斜坡（前 4 列）打不到越过屋脊的目标", () => {
    for (const col of [0, 1, 2, 3]) {
      const e = roof();
      fire(e, e.addPlant("pea", 0, col));
      e.spawn("basic", 0, 7);
      fire(e, e.at(0, col, "main")!);
      expect(e.shots, `第 ${col} 列不该开火`).toHaveLength(0);
      expect(e.zombies[0].hp).toBe(e.zombies[0].max);
    }
  });

  it("斜坡射手能打到仍在斜坡上的目标（含自己这一格）", () => {
    for (const x of [3.5, 2, 0.5]) {
      const e = roof();
      const pea = e.addPlant("pea", 0, 0);
      pea.timer = 0;
      e.spawn("basic", 0, x);
      const z = e.zombies[e.zombies.length - 1];
      // step() 会把单次 dt 夹到 0.1 秒，这里按 1/60 推进 0.8 秒让豌豆飞完。
      for (let i = 0; i < 48; i++) e.step(1 / 60);
      expect(z.hp, `目标 x=${x} 应当可以打到`).toBeLessThan(z.max);
    }
  });

  it("平屋顶（第 4 列及以后）射程不受限制", () => {
    const e = roof();
    const pea = e.addPlant("pea", 0, 4);
    e.spawn("basic", 0, 7);
    fire(e, pea);
    expect(e.shots).toHaveLength(1);
  });

  it("投手（lob）越过斜坡照常出手", () => {
    const e = roof();
    const pult = e.addPlant("cabbage", 0, 0);
    e.spawn("basic", 0, 7);
    fire(e, pult);
    expect(e.shots).toHaveLength(1);
  });

  it("三线射手逐排同样受斜坡限制", () => {
    const e = roof();
    const three = e.addPlant("three", 1, 0);
    e.spawn("basic", 0, 7);
    e.spawn("basic", 1, 7);
    e.spawn("basic", 2, 7);
    fire(e, three);
    expect(e.shots).toHaveLength(0);
  });

  it("裂荚射手在斜坡上仍能打身后的目标", () => {
    const e = roof();
    const split = e.addPlant("split", 0, 2);
    e.spawn("basic", 0, 1); // 目标在身后，不越过屋脊
    fire(e, split);
    expect(e.shots.length).toBeGreaterThan(0);
    expect(e.shots.every((s) => s.direction === -1)).toBe(true);
  });

  it("首次被斜坡拦下时解释一次，不重复刷屏", () => {
    const e = roof();
    const pea = e.addPlant("pea", 0, 0);
    e.spawn("basic", 0, 7);
    fire(e, pea);
    expect(e.message).toContain("斜坡");
    e.message = "";
    fire(e, e.at(0, 0, "main")!);
    expect(e.message).toBe("");
  });

  it("非屋顶关射程不受影响", () => {
    const e = new Engine(1, []);
    const pea = e.addPlant("pea", 0, 0);
    e.spawn("basic", 0, 7);
    fire(e, pea);
    expect(e.shots).toHaveLength(1);
  });

  it("已知例外：电弧花是瞬发能量攻击，不受斜坡限制", () => {
    const e = roof();
    const arc = e.addPlant("arc", 0, 0);
    e.spawn("basic", 0, 7);
    fire(e, arc);
    expect(e.zombies[0].hp).toBeLessThan(e.zombies[0].max);
  });
});

describe("地刺与屋顶", () => {
  it("种植：屋顶（含花盆）与水路都拒绝，陆地正常", () => {
    const e = roof(["spike"]);
    expect(e.canPlant("spike", 0, 3)).toBe("地刺只能种在陆地");
    e.addPlant("pot", 0, 3);
    expect(e.canPlant("spike", 0, 3)).toBe("地刺只能种在陆地");
    expect(e.canPlant("spikerock", 0, 3)).toBe("地刺只能种在陆地");

    const pool = new Engine(21, ["spike"]);
    expect(pool.canPlant("spike", 2, 0)).toBe("地刺只能种在陆地");
    pool.addPlant("lily", 2, 0);
    expect(pool.canPlant("spike", 2, 0)).toBe("地刺只能种在陆地");

    const day = new Engine(1, ["spike"]);
    expect(day.canPlant("spike", 0, 3)).toBe("");
  });

  it("移植：地刺不能移到屋顶，与种植规则一致", () => {
    const e = roof();
    const spike = e.addPlant("spike", 0, 0);
    e.selectTool();
    e.useTool(0, 0); // 选中地刺作为移植来源
    expect(e.toolSource).toBe(spike.uid);
    expect(e.useTool(0, 5)).toBe(false);
    expect(e.message).toContain("陆地");
  });

  it("开局预置花盆按关卡行数铺满左侧 3 列", () => {
    const e = roof();
    const pots = e.plants.filter((p) => p.id === "pot");
    expect(pots).toHaveLength(e.level.rows * 3);
    expect(new Set(pots.map((p) => p.col))).toEqual(new Set([0, 1, 2]));
  });
});

describe("屋顶出怪节奏", () => {
  it("5-1 不再出现无克星的蹦极（保护伞要到 47 关才解锁）", () => {
    const fiveOne = levels.find((l) => l.label === "5-1")!;
    expect(fiveOne.enemies).not.toContain("bungee");
    // 5-2 起蹦极与扶梯一起登场。
    const fiveTwo = levels.find((l) => l.label === "5-2")!;
    expect(fiveTwo.enemies).toContain("bungee");
    expect(fiveTwo.enemies).toContain("ladder");
  });
});
