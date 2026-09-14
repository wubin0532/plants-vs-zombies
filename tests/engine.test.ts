import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { plants, levels, zombieById, plantById } from "../src/game/content";
import { initial, validateSave } from "../src/store";
const run = (e: Engine, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) e.step(1 / 60);
};
describe("基础战斗", () => {
  it("拒绝重复种植时不扣除资源；冷却与阳光独立检查", () => {
    const e = new Engine(1, ["pea"]);
    expect(e.plant("pea", 0, 0)).toBe(true);
    expect(e.sun).toBe(50);
    e.sun = 500;
    expect(e.plant("pea", 0, 0)).toBe(false);
    expect(e.sun).toBe(500);
    expect(e.plant("pea", 1, 0)).toBe(false);
    run(e, 8);
    expect(e.plant("pea", 1, 0)).toBe(true);
  });
  it("暂停时不推进时间、冷却或收集阳光", () => {
    const e = new Engine(1, ["pea"]);
    e.plant("pea", 0, 0);
    e.token(0, 0);
    e.paused = true;
    const uid = e.tokens[0].uid;
    run(e, 10);
    e.collect(uid);
    expect(e.time).toBe(0);
    expect(e.sun).toBe(50);
    expect(e.cooldowns.pea).toBe(7.5);
  });
  it("护甲先吸收伤害，穿透伤害作用于本体", () => {
    const e = new Engine(1, []);
    e.spawn("bucket", 0, 8);
    const z = e.zombies[0];
    e.damage(z, 20);
    expect(z.armor).toBe(zombieById.bucket.armor - 20);
    expect(z.hp).toBe(zombieById.bucket.hp);
    e.damage(z, 80, true);
    expect(z.hp).toBe(zombieById.bucket.hp - 80);
  });
  it("同一行第一次漏怪触发割草机，第二次导致失败", () => {
    const e = new Engine(1, []);
    e.spawn("basic", 0, -0.7);
    e.step(0.02);
    expect(e.mowers[0]).toBe(false);
    expect(e.status).toBe("playing");
    e.spawn("basic", 0, -0.7);
    e.step(0.02);
    expect(e.status).toBe("lost");
  });
  it("射手通过弹道击杀敌人", () => {
    const e = new Engine(1, []);
    e.addPlant("pea", 0, 0);
    e.spawn("basic", 0, 2);
    run(e, 16);
    expect(e.kills).toBe(1);
    expect(e.plants).toHaveLength(1);
  });
});
describe("场地与能力", () => {
  it("水路必须先放睡莲，铲除顺序保留底座", () => {
    const e = new Engine(21, ["lily", "pea"]);
    e.sun = 500;
    expect(e.plant("pea", 2, 0)).toBe(false);
    expect(e.plant("lily", 2, 0)).toBe(true);
    expect(e.plant("pea", 2, 0)).toBe(true);
    e.shovel(2, 0);
    expect(e.at(2, 0)?.id).toBe("lily");
  });
  it("屋顶花盆约束与蘑菇睡眠、咖啡唤醒", () => {
    const e = new Engine(44, ["puff", "coffee"]);
    e.sun = 1000;
    expect(e.canPlant("puff", 0, 8)).toContain("花盆");
    expect(e.plant("puff", 0, 0)).toBe(true);
    expect(e.at(0, 0, "main")?.sleep).toBe(true);
    expect(e.plant("coffee", 0, 0)).toBe(true);
    expect(e.at(0, 0, "main")?.sleep).toBe(false);
  });
  it("撑杆只能跳一次，高坚果阻止跳跃", () => {
    const e = new Engine(1, []);
    e.addPlant("wallnut", 0, 3);
    e.spawn("pole", 0, 3.3);
    e.step(0.02);
    expect(e.zombies[0].jumped).toBe(true);
    expect(e.zombies[0].x).toBe(3.3);
    expect(e.zombies[0].jump).toBeDefined();
    run(e, 0.9);
    expect(e.zombies[0].x).toBeLessThan(3);
    expect(e.zombies[0].jump).toBeUndefined();
    const f = new Engine(1, []);
    f.addPlant("tallnut", 0, 3);
    f.spawn("pole", 0, 3.3);
    f.step(0.02);
    expect(f.zombies[0].jumped).toBe(false);
  });
  it("寒冰菇冻结全场；首领关夜间蘑菇可用并熄灭火球", () => {
    const e = new Engine(50, ["ice"]);
    e.bossBall = { row: 0, x: 8, type: "fire" };
    e.addPlant("ice", 0, 0);
    e.spawn("bucket", 0, 6);
    run(e, 1.2);
    expect(e.zombies[0].freeze).toBeGreaterThan(0);
    expect(e.bossBall).toBeNull();
  });
  it("墓碑吞噬者清除墓碑", () => {
    const e = new Engine(14, ["grave"]);
    e.sun = 500;
    const t = e.tiles[0];
    expect(e.plant("grave", t.row, t.col)).toBe(true);
    run(e, 1.2);
    expect(
      e.tiles.find((x) => x.row === t.row && x.col === t.col),
    ).toBeUndefined();
  });
  it("传送带不消耗阳光并消耗种子，保龄球会滚动", () => {
    const e = new Engine(5, ["wallnut"]);
    e.conveyor = ["wallnut"];
    expect(e.plant("wallnut", 0, 0)).toBe(true);
    expect(e.sun).toBe(0);
    expect(e.conveyor).toHaveLength(0);
    expect(e.bowls).toHaveLength(1);
    run(e, 1);
    expect(e.bowls[0].x).toBeGreaterThan(3);
  });
  it("扶梯架在高坚果上，普通僵尸可以跨过", () => {
    const e = new Engine(43, []);
    const p = e.addPlant("tallnut", 0, 5);
    e.spawn("ladder", 0, 5.1);
    e.step(0.02);
    expect(p.ladder).toBe(true);
    e.spawn("basic", 0, 5.1);
    e.step(0.02);
    expect(e.zombies.at(-1)!.jump).toBeDefined();
    run(e, 0.8);
    expect(e.zombies.at(-1)!.x).toBeLessThan(5);
  });
  it("模仿者使用被模仿植物费用和独立冷却", () => {
    const e = new Engine(1, ["pea", "imitater"]);
    e.imitate = "pea";
    e.sun = 500;
    expect(e.plant("pea", 0, 0)).toBe(true);
    expect(e.plant("imitater", 1, 0)).toBe(true);
    expect(e.sun).toBe(300);
    expect(e.plants.map((p) => p.id)).toEqual(["pea", "pea"]);
  });
});
describe("内容与存档", () => {
  it("50 关引用的敌人与植物均存在，全部图鉴唯一", () => {
    expect(levels).toHaveLength(50);
    expect(plants).toHaveLength(49);
    expect(new Set(plants.map((p) => p.id)).size).toBe(49);
    for (const l of levels)
      for (const id of l.enemies) expect(zombieById[id]).toBeDefined();
    for (const p of plants)
      if (p.upgrade) expect(plantById[p.upgrade]).toBeDefined();
  });
  it("存档拒绝越界和非连续解锁", () => {
    expect(validateSave(initial())).toEqual(initial());
    expect(() => validateSave({ ...initial(), unlocked: 99 })).toThrow();
    expect(() =>
      validateSave({ ...initial(), unlocked: 3, completed: [2] }),
    ).toThrow();
    expect(
      validateSave({ ...initial(), unlocked: 3, completed: [1, 2] }).unlocked,
    ).toBe(3);
  });
  it("固定种子和相同操作得到相同进攻", () => {
    const a = new Engine(18, [], 42),
      b = new Engine(18, [], 42);
    run(a, 40);
    run(b, 40);
    expect(a.zombies).toEqual(b.zombies);
  });
});
