import { it, expect, describe, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { Engine } from "../src/game/engine";
import { zombies, plantById } from "../src/game/content";
import { initial, validateSave, useSave } from "../src/store";

it("每个僵尸的 counters 都指向真实植物 id", () => {
  for (const z of zombies) {
    expect(Array.isArray(z.counters)).toBe(true);
    for (const id of z.counters) expect(plantById[id], `${z.id} → ${id}`).toBeDefined();
  }
});
it("3 秒内 4 次击杀触发连杀奖励，10 秒冷却", () => {
  const e = new Engine(1, [], 7);
  const kill = (n: number) => {
    for (let i = 0; i < n; i++) e.spawn("basic", 0, 5);
    for (const z of e.zombies) e.damage(z, 99999, true);
    e.step(0.1);
  };
  kill(3);
  expect(e.tokens.some((t) => !t.coin && t.value === 25)).toBe(false);
  kill(1);
  expect(e.tokens.some((t) => !t.coin && t.value === 25)).toBe(true);
  expect(e.message).toContain("连杀奖励");
  kill(4);
  expect(e.tokens.filter((t) => !t.coin && t.value === 25)).toHaveLength(1);
  for (let i = 0; i < 110; i++) e.step(0.1);
  kill(4);
  expect(e.tokens.filter((t) => !t.coin && t.value === 25).length).toBeGreaterThanOrEqual(2);
});
describe("lossStreak", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("连败计数累加，胜利清零", () => {
    const save = useSave();
    save.recordLoss(5);
    save.recordLoss(5);
    expect(save.data.lossStreak[5]).toBe(2);
    save.win(5, 0);
    expect(save.data.lossStreak[5]).toBeUndefined();
  });
  it("宽松校验：非法条目丢弃", () => {
    const save = validateSave({
      ...initial(),
      lossStreak: { 3: 2, 99: 1, x: -1 },
    });
    expect(save.lossStreak).toEqual({ 3: 2 });
  });
});
