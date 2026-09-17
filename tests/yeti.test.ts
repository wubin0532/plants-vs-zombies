import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { zombieById } from "../src/game/content";

const run = (e: Engine, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.step(1 / 60);
};
/** 快进到所有波次结束（一步内处理完整个出怪表）。 */
const finish = (e: Engine) => {
  e.time = 1e9;
  e.step(1 / 60);
};
const yetis = (e: Engine) => e.zombies.filter((z) => z.id === "yeti");

describe("雪人僵尸触发", () => {
  it("图鉴属性不变：1350 血、速度 14、无护甲", () => {
    const d = zombieById.yeti;
    expect(d.hp).toBe(1350);
    expect(d.speed).toBe(14);
    expect(d.armor).toBe(0);
  });
  it("首玩（未通关）任何种子都不出现雪人", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const e = new Engine(8, [], seed);
      expect(e.replay).toBeUndefined();
      finish(e);
      expect(yetis(e)).toHaveLength(0);
      expect(e.message).not.toContain("雪人僵尸");
    }
  });
  it("通关重玩时低概率出现且一局至多一次，不同种子结果有差异", () => {
    let appeared = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const e = new Engine(8, [], seed);
      e.replay = true;
      finish(e);
      expect(yetis(e).length).toBeLessThanOrEqual(1);
      if (yetis(e).length) appeared++;
    }
    // 设计概率约 20%，允许 LCG 小样本波动，但必须既有出现也有不出现。
    expect(appeared).toBeGreaterThanOrEqual(6);
    expect(appeared).toBeLessThanOrEqual(30);
  });
  it("同一种子结果确定，且雪人混在中段的波次出现", () => {
    const appear = (seed: number) => {
      const e = new Engine(8, [], seed);
      e.replay = true;
      finish(e);
      return yetis(e).length;
    };
    expect(appear(1)).toBe(1);
    expect(appear(1)).toBe(appear(1));
    expect(appear(2)).toBe(0);
    // 逐波推进，确认雪人只在中段窗口 [1/3, 2/3] 的某一波开始混入
    const e = new Engine(8, [], 1);
    e.replay = true;
    const total = e.totalWaves;
    let seen = 0;
    for (let w = 1; w <= total; w++) {
      const at = e.schedule.find((ev) => ev.wave === w)?.at;
      if (at === undefined) continue;
      e.time = at;
      e.step(1 / 60);
      if (!seen && e.zombies.some((z) => z.id === "yeti")) seen = w;
    }
    expect(seen).toBeGreaterThanOrEqual(Math.ceil(total / 3));
    expect(seen).toBeLessThanOrEqual(Math.floor((total * 2) / 3));
  });
  it("非普通模式（传送带/保龄球/砸罐/暴风雨/博士）不出现雪人", () => {
    for (const id of [5, 10, 15, 35, 40, 50]) {
      const e = new Engine(id, [], 1);
      e.replay = true;
      finish(e);
      expect(yetis(e)).toHaveLength(0);
    }
  });
  it("雪人出场沿用既有逃跑逻辑：15 秒后转身离开，不算击杀", () => {
    const e = new Engine(8, [], 42);
    e.spawn("yeti", 0);
    const z = e.zombies.at(-1)!;
    expect(z.reverse).toBe(false);
    run(e, 15.5);
    expect(z.reverse).toBe(true);
    const kills = e.kills;
    run(e, 60);
    expect(e.zombies).not.toContain(z);
    expect(z.hp).toBeGreaterThan(0);
    expect(e.kills).toBe(kills);
  });
  it("雪人被击败正常计入击杀", () => {
    const e = new Engine(8, [], 42);
    e.spawn("yeti", 0);
    const z = e.zombies.at(-1)!;
    e.damage(z, 9999, true);
    run(e, 0.1);
    expect(e.kills).toBe(1);
  });
});
