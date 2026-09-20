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
  expect(["rain", "wind", "overcast", "blazing"]).toContain(a.eventKind);
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
  expect(e.tokens.length).toBeGreaterThanOrEqual(2);
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

const step = (e: Engine, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 10); i++) e.step(0.1);
};

it("阴天：产阳光植物计时减半，8 秒后恢复", () => {
  const e = new Engine(4, []);
  const p = e.addPlant("sunflower", 0, 0);
  p.timer = 12;
  e.eventKind = "overcast";
  e.eventAt = 0.1;
  step(e, 0.2);
  expect(e.message).toContain("阴天");
  expect(e.overcastUntil).toBeGreaterThan(e.time);
  const before = p.timer;
  step(e, 1);
  expect(before - p.timer).toBeCloseTo(0.5, 1);
  step(e, 8);
  const normalBefore = p.timer;
  step(e, 1);
  expect(normalBefore - p.timer).toBeCloseTo(1, 1);
});

it("停电：产阳光植物计时完全停滞", () => {
  const e = new Engine(4, []);
  const p = e.addPlant("sunflower", 0, 0);
  p.timer = 12;
  e.eventKind = "blackout";
  e.eventAt = 0.1;
  step(e, 0.2);
  expect(e.message).toContain("停电");
  const before = p.timer;
  step(e, 1);
  expect(p.timer).toBeCloseTo(before, 5);
});

it("烈日：天降阳光更快，僵尸移速提升", () => {
  const fast = new Engine(4, []);
  fast.eventKind = "blazing";
  fast.eventAt = 0.1;
  const slow = new Engine(4, []);
  slow.eventAt = -1;
  fast.spawn("basic", 0, 8);
  slow.spawn("basic", 0, 8);
  step(fast, 0.2);
  expect(fast.message).toContain("烈日");
  const sky = (e: Engine) => e.tokens.filter((t) => t.origin === "sky").length;
  step(fast, 14);
  step(slow, 14);
  expect(sky(fast)).toBeGreaterThan(sky(slow));
  expect(8 - fast.zombies[0].x).toBeGreaterThan(8 - slow.zombies[0].x);
});

it("随机天气同种子可复现，困难模式包含停电", () => {
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) {
    const a = new Engine(8, [], seed);
    const b = new Engine(8, [], seed);
    expect(a.eventKind).toBe(b.eventKind);
    kinds.add(a.eventKind);
  }
  for (const k of kinds) expect(["rain", "wind", "overcast", "blazing"]).toContain(k);
  const hard = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) hard.add(new Engine(8, [], seed, { difficulty: "hard" }).eventKind);
  expect(hard.has("blackout")).toBe(true);
});
