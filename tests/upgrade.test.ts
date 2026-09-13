import { describe, it, expect } from "vitest";
import {
  battleSettings,
  makeWaves,
  normalizeOptions,
} from "../src/game/difficulty";
import { levels } from "../src/game/content";
import { Engine } from "../src/game/engine";
import {
  cellAt,
  cellX,
  cellY,
  BOARD,
  healthFraction,
} from "../src/game/layout";
import { initial, validateSave } from "../src/store";
describe("升级回归", () => {
  it("普通关卡采用章节时长，波次单调且末波留出清场时间", () => {
    for (const level of levels.filter((l) => l.mode === "normal")) {
      const settings = battleSettings(level);
      expect(settings.duration).toBeGreaterThanOrEqual(
        level.world >= 3 ? 720 : 480,
      );
      expect(settings.duration).toBeLessThanOrEqual(
        level.world >= 3 ? 900 : 720,
      );
      const waves = makeWaves(level, settings);
      expect(waves[0].at).toBe(settings.prep);
      expect(waves.at(-1)!.at).toBe(settings.duration - 45);
      expect(waves.every((w, i) => i === 0 || w.at >= waves[i - 1].at)).toBe(
        true,
      );
    }
  });
  it("自定义范围校验与旧存档迁移", () => {
    expect(
      normalizeOptions({ minutes: 100, speed: 0, density: NaN }),
    ).toMatchObject({ minutes: 30, speed: 0.75, density: 1 });
    const old = {
      version: 1,
      unlocked: 1,
      completed: [],
      coins: 0,
      sound: true,
      options: null,
    };
    expect(validateSave(old)).toEqual(initial());
  });
  it("困难增加出怪，生命速度与割草机按自定义应用", () => {
    const l = levels[0];
    expect(
      makeWaves(l, battleSettings(l, { difficulty: "hard" })).length,
    ).toBeGreaterThan(
      makeWaves(l, battleSettings(l, { difficulty: "casual" })).length,
    );
    const e = new Engine(1, [], 1, {
      difficulty: "custom",
      health: 2,
      mowers: false,
    });
    e.spawn("basic", 0, 8);
    expect(e.zombies[0].max).toBe(400);
    expect(e.mowers.every((v) => !v)).toBe(true);
  });
  it("画面坐标和点击在五行六行中一致", () => {
    for (const rows of [5, 6])
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < 9; col++)
          expect(cellAt(cellX(col), cellY(row, rows), rows)).toEqual({
            col,
            row,
          });
    expect(BOARD.mowerX).toBeGreaterThan(BOARD.houseRight);
    expect(BOARD.mowerX).toBeLessThan(BOARD.left);
    expect(healthFraction(-3, 200)).toBe(0);
    expect(healthFraction(300, 200)).toBe(1);
  });
  it("声音事件仅消费一次，暂停无事件增长，爆炸标识保留", () => {
    const e = new Engine(1, ["pea"]);
    e.plant("pea", 0, 0);
    expect(e.drainSounds().some((s) => s.kind === "plant")).toBe(true);
    expect(e.drainSounds()).toEqual([]);
    e.blast(4, 0, 1, 1800, "doom");
    expect(e.effects.at(-1)?.source).toBe("doom");
    expect(e.drainSounds().some((s) => s.kind === "explosion")).toBe(true);
    e.paused = true;
    e.step(1);
    expect(e.drainSounds()).toEqual([]);
  });
});
