import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { dailyChallenge } from "../src/game/daily";
import { isNight, levels } from "../src/game/content";
import { initial, validateSave, seedSlotPriceFor } from "../src/store";
import { checkAchievements } from "../src/achievements";

it("每日挑战由日期决定，必带产阳光植物，夜间用蘑菇", () => {
  const a = dailyChallenge(new Date(2026, 8, 14), 50);
  expect(a).toEqual(dailyChallenge(new Date(2026, 8, 14), 50));
  // 种子改为日期哈希（旧实现直接用日期数字，导致关卡几十天不变）。
  expect(a.seed).toBeGreaterThan(0);
  expect(a.seed).toBeLessThanOrEqual(0xffffffff);
  for (let d = 1; d <= 28; d++) {
    const c = dailyChallenge(new Date(2026, 0, d), 50);
    // 词缀「精简卡组」会把张数压到 4；「加宽卡组」上限仍是 8。
    expect(c.cards.length).toBeGreaterThanOrEqual(4);
    expect(c.cards.length).toBeLessThanOrEqual(8);
    expect(c.cards).toContain(
      isNight(levels[c.levelId - 1].scene) ? "sunshroom" : "sunflower",
    );
    expect(new Set(c.cards).size).toBe(c.cards.length);
  }
});
it("备用小推车在主推车用完后兜底", () => {
  const e = new Engine(1, []);
  e.spareMowers.fill(true);
  e.spawn("basic", 0, -0.7);
  e.step(0.1);
  expect(e.mowersLost).toBe(1);
  expect(e.mowers[0]).toBe(false);
  expect(e.spareMowers[0]).toBe(true);
  expect(e.status).toBe("playing");
  e.spawn("basic", 0, -0.7);
  e.step(0.1);
  expect(e.mowersLost).toBe(2);
  expect(e.spareMowers[0]).toBe(false);
  expect(e.status).toBe("playing");
  e.spawn("basic", 0, -0.7);
  e.step(0.1);
  expect(e.status).toBe("lost");
});
it("备用小推车结算只按实际触发次数计", () => {
  const fresh = new Engine(1, []);
  expect(fresh.mowersLost).toBe(0);
  expect(fresh.mowersLost === 0).toBe(true);

  const mainUsed = new Engine(1, []);
  mainUsed.spareMowers.fill(true);
  mainUsed.spawn("basic", 0, -0.7);
  mainUsed.step(0.1);
  expect(mainUsed.mowersLost).toBe(1);

  const spareUsed = new Engine(1, []);
  spareUsed.spareMowers.fill(true);
  spareUsed.spawn("basic", 0, -0.7);
  spareUsed.step(0.1);
  spareUsed.spawn("basic", 0, -0.7);
  spareUsed.step(0.1);
  expect(spareUsed.mowersLost).toBe(2);
});
it("新存档字段宽松校验，非法值丢弃", () => {
  const save = validateSave({
    ...initial(),
    stars: { 1: 3, 99: 2, a: 5, 2: -1 },
    daily: { date: "20260914", best: 305.5 },
    achievements: ["first-win", 42],
    items: { "sun-boost": 2, bad: -1 },
    kills: 120,
    contrast: true,
    fontSize: "huge",
  });
  expect(save.stars).toEqual({ 1: 3 });
  expect(save.daily).toEqual({ date: "20260914", best: 305.5 });
  expect(save.achievements).toEqual(["first-win"]);
  expect(save.items).toEqual({ "sun-boost": 2 });
  expect(save.kills).toBe(120);
  expect(save.contrast).toBe(true);
  expect(save.fontSize).toBe("standard");
});
it("种子槽价格阶梯与存档迁移", () => {
  expect(seedSlotPriceFor(0)).toBe(600);
  expect(seedSlotPriceFor(1)).toBe(1400);
  expect(seedSlotPriceFor(2)).toBe(2800);
  expect(seedSlotPriceFor(3)).toBe(4800);
  expect(seedSlotPriceFor(4)).toBe(4800); // 已满级，价格不再变化

  const save = validateSave({
    ...initial(),
    seedSlots: 3,
    items: { "sun-boost": 2, "ice-start": 3 },
  });
  expect(save.seedSlots).toBe(3);
  expect(save.items).toEqual({ "sun-boost": 2 });
  expect(validateSave({ ...initial() }).seedSlots).toBe(0);
});
it("成就按存档与战果判定，已解锁不重复", () => {
  const save = initial();
  expect(checkAchievements(save)).toEqual([]);
  save.completed = Array.from({ length: 10 }, (_, i) => i + 1);
  const fresh = checkAchievements(save, {
    coins: 1200,
    difficulty: "hard",
    mowersIntact: true,
  }).map((a) => a.id);
  for (const id of [
    "first-win",
    "world-clear",
    "coin-1000",
    "hard-win",
    "no-mower",
  ])
    expect(fresh).toContain(id);
  expect(fresh).not.toContain("all-clear");
  save.achievements.push(...fresh);
  expect(checkAchievements(save)).toEqual([]);
});
