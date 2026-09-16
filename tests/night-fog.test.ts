import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { applyControl } from "../src/game/elements";
import { levels, plants, plantById, recommendCards } from "../src/game/content";

const run = (e: Engine, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.step(1 / 60);
};

describe("夜晚经济", () => {
  it("夜晚向日葵生产间隔放慢到 36 秒，白天仍为 24 秒", () => {
    const night = new Engine(11, []);
    const np = night.addPlant("sunflower", 0, 0);
    np.timer = 0;
    night.step(1 / 60);
    expect(np.timer).toBe(36);
    const day = new Engine(1, []);
    const dp = day.addPlant("sunflower", 0, 0);
    dp.timer = 0;
    day.step(1 / 60);
    expect(dp.timer).toBe(24);
  });
  it("阳光菇在夜晚保持 24 秒间隔", () => {
    const e = new Engine(11, []);
    const p = e.addPlant("sunshroom", 0, 0);
    p.timer = 0;
    e.step(1 / 60);
    expect(p.timer).toBe(24);
  });
  it("夜晚普通关开局提示没有天降阳光", () => {
    const e = new Engine(11, []);
    expect(e.message).toContain("夜晚没有天降阳光");
  });
});

describe("墓碑", () => {
  it("墓碑吞噬者第 12 关解锁", () => {
    expect(plantById.grave.unlock).toBe(12);
  });
  it("迷雾关也生成墓碑，且不落在水路行", () => {
    const e = new Engine(31, []);
    const graves = e.tiles.filter((t) => t.type === "grave");
    expect(graves.length).toBeGreaterThan(0);
    expect(graves.every((t) => [0, 1, 4, 5].includes(t.row))).toBe(true);
  });
  it("最终波墓碑爬出僵尸并播报警告，前期关卡均为普通僵尸", () => {
    const e = new Engine(11, []);
    const graves = e.tiles.filter((t) => t.type === "grave").length;
    expect(graves).toBeGreaterThan(0);
    e.time = 1e9;
    e.step(1 / 60);
    expect(e.message).toContain("墓碑里爬出了僵尸");
    const ambush = e.zombies.filter((z) => z.x <= 8);
    expect(ambush).toHaveLength(graves);
    expect(ambush.every((z) => z.id === "basic")).toBe(true);
    expect(e.zombies.length).toBeGreaterThan(graves);
    expect(e.effects.some((fx) => fx.type === "dust")).toBe(true);
  });
  it("第 8 阶段起墓碑混入路障与铁桶", () => {
    const e = new Engine(18, []);
    e.time = 1e9;
    e.step(1 / 60);
    const ambush = e.zombies.filter((z) => z.x <= 8);
    expect(ambush.some((z) => z.id === "bucket")).toBe(true);
    expect(ambush.some((z) => z.id === "cone")).toBe(true);
  });
});

describe("冰电平衡", () => {
  it("同一僵尸 4 秒内只触发一次爆发，冷却中不消耗冰控", () => {
    const e = new Engine(8, []);
    e.spawn("basic", 2, 5);
    const z = e.zombies[0];
    z.hp = z.max = 5000;
    z.armor = 0;
    applyControl(z, "iceSlow", 30);
    e.electricHit(z, 20);
    expect(z.hp).toBe(4880);
    expect(z.iceSlow).toBe(0);
    applyControl(z, "iceSlow", 30);
    e.electricHit(z, 20);
    expect(z.hp).toBe(4860);
    expect(z.iceSlow).toBeGreaterThan(0);
    expect(e.reactions).toBe(1);
  });
  it("冷却结束后可再次爆发，传导伤害为 40", () => {
    const e = new Engine(8, []);
    e.spawn("basic", 2, 5);
    const a = e.zombies[0];
    a.hp = a.max = 5000;
    a.armor = 0;
    e.spawn("basic", 2, 6);
    const b = e.zombies[1];
    b.hp = b.max = 5000;
    b.armor = 0;
    applyControl(a, "iceSlow", 30);
    e.electricHit(a, 20);
    expect(b.hp).toBe(4960);
    run(e, 4.1);
    applyControl(a, "iceSlow", 30);
    e.electricHit(a, 20);
    expect(a.hp).toBe(4760);
    expect(e.reactions).toBe(2);
  });
});

describe("选卡推荐", () => {
  const all = plants.map((p) => p.id);
  it("气球僵尸关卡推荐仙人掌或三叶草", () => {
    const level = levels[32];
    expect(level.enemies).toContain("balloon");
    const rec = recommendCards(level, all, 8);
    expect(rec.some((id) => ["cactus", "blover"].includes(id))).toBe(true);
  });
  it("迷雾关推荐阳光菇、路灯花与墓碑吞噬者，不推荐向日葵", () => {
    const level = levels[30];
    expect(level.scene).toBe("fog");
    const rec = recommendCards(level, all, 8);
    expect(rec).toContain("sunshroom");
    expect(rec).toContain("lantern");
    expect(rec).toContain("grave");
    expect(rec).not.toContain("sunflower");
  });
  it("夜晚关推荐墓碑吞噬者与阳光菇", () => {
    const rec = recommendCards(levels[11], all, 8);
    expect(rec).toContain("grave");
    expect(rec).toContain("sunshroom");
  });
  it("夜晚阳光菇未解锁时退回推荐向日葵", () => {
    const level = levels[10];
    const unlocked = all.filter((id) => plantById[id].unlock <= 11);
    expect(unlocked).not.toContain("sunshroom");
    expect(recommendCards(level, unlocked, 6)).toContain("sunflower");
  });
  it("未解锁的植物不出现，升级植物不推荐", () => {
    const rec = recommendCards(levels[0], ["pea", "sunflower"], 6);
    expect(rec.every((id) => ["pea", "sunflower"].includes(id))).toBe(true);
    expect(recommendCards(levels[44], all, 10)).not.toContain("twin");
  });
  it("推荐数量不超过槽位数", () => {
    expect(recommendCards(levels[49], all, 5).length).toBeLessThanOrEqual(5);
  });
});
