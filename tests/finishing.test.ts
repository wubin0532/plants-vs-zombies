import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { initial, validateSave } from "../src/store";

it("随机事件由种子决定，同种子同时刻同类型", () => {
  const a = new Engine(4, [], 42);
  const b = new Engine(4, [], 42);
  expect(a.eventAt).toBe(b.eventAt);
  expect(a.eventKind).toBe(b.eventKind);
  expect(a.eventAt).toBeGreaterThan(a.settings.duration * 0.3 - 1);
  expect(a.eventAt).toBeLessThan(a.settings.duration * 0.7 + 1);
  expect(["rain", "wind"]).toContain(a.eventKind);
});
it("寒风：触发一次且仅一次，全场僵尸减速", () => {
  const e = new Engine(4, [], 42);
  e.eventKind = "wind";
  e.eventAt = 0.1;
  e.spawn("basic", 0, 6);
  e.step(0.2);
  expect(e.eventAt).toBe(-1);
  expect(e.zombies[0].slow).toBeGreaterThan(4);
  expect(e.message).toContain("寒风");
  expect(e.windUntil).toBeGreaterThan(e.time);
  for (let i = 0; i < 100; i++) {
    e.step(0.1);
    expect(e.eventAt).toBe(-1);
  }
});
it("阳光雨：向日葵立即产出，掉落间隔减半，10 秒后恢复", () => {
  const e = new Engine(4, [], 42);
  e.eventKind = "rain";
  e.eventAt = 0.1;
  e.addPlant("sunflower", 0, 0);
  const before = e.tokens.length;
  e.step(0.2);
  expect(e.eventAt).toBe(-1);
  expect(e.message).toContain("阳光雨");
  expect(e.rainUntil).toBeGreaterThan(e.time);
  expect(e.tokens.length).toBe(before + 1);
  e.plants = [];
  e.tokens = [];
  for (let i = 0; i < 100; i++) e.step(0.1);
  expect(e.tokens.length).toBeGreaterThanOrEqual(3);
  while (e.time < e.rainUntil + 0.5) e.step(0.1);
  e.tokens = [];
  for (let i = 0; i < 60; i++) e.step(0.1);
  expect(e.tokens.length).toBe(1);
});
it("v1 存档迁移到 v2 且字段齐全，v2 原样通过", () => {
  const v1 = {
    ...JSON.parse(JSON.stringify(initial())),
    version: 1,
    stars: undefined,
    daily: undefined,
    achievements: undefined,
  };
  const migrated = validateSave(v1);
  expect(migrated.version).toBe(2);
  expect(migrated.stars).toEqual({});
  expect(migrated.daily).toEqual({ date: "", best: 0 });
  expect(migrated.achievements).toEqual([]);
  expect(migrated.fontSize).toBe("standard");
  const v2 = validateSave(JSON.parse(JSON.stringify(initial())));
  expect(v2.version).toBe(2);
});
it("v3 与非法存档被拒绝", () => {
  expect(() => validateSave({ ...initial(), version: 3 })).toThrow();
  expect(() => validateSave(null)).toThrow();
  expect(() => validateSave({ version: 2 })).toThrow();
});
