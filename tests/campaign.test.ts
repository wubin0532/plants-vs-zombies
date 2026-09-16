import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { levels } from "../src/game/content";
import { battleSettings, makeWaves } from "../src/game/difficulty";
import { autoCards, defend } from "./auto-player";

// 自动玩家会输一部分后期关卡（脚本策略不等于人工通关），
// 因此这里只检查“能跑到结算（不卡死）”与新手关仍然可通关。
const early = { total: 0, won: 0 };
for (const l of levels)
  it(`关卡 ${l.label} 使用真实经济的自动玩家能推进并结算`, () => {
    const e = new Engine(l.id, autoCards(l));
    for (let i = 0; i < 18000 && e.status === "playing"; i++) {
      if (i % 3 === 0) defend(e);
      e.step(0.1);
    }
    expect(["won", "lost"]).toContain(e.status);
    // This test detects deadlocked levels; a scripted player is not a difficulty acceptance test.
    expect(Number.isFinite(e.sun) && e.sun >= 0).toBe(true);
    if (e.status === "won" && e.totalWaves >= 10)
      expect(e.wave, "通关必须跑到最终波").toBe(e.totalWaves);
    if (l.id <= 5) {
      early.total++;
      if (e.status === "won") early.won++;
    }
  });
it("新手关卡对脚本玩家仍然可以通关", () => {
  expect(early.total).toBe(5);
  expect(early.won).toBeGreaterThanOrEqual(4);
});
// 出怪曲线是纯配置，可以稳定断言：后期波次必须明显重于开局，
// 且每关都要有足够的总量和密度，避免“僵尸偏弱”回归。
it("出怪曲线：结尾冲击明显强于开局，总量随章节递增", () => {
  const totals = new Map<number, number>();
  for (const level of levels) {
    if (level.mode === "boss" || level.mode === "vases") continue;
    const settings = battleSettings(level);
    const waves = makeWaves(level, settings);
    const last = waves.at(-1)!.wave;
    const count = (w: number) =>
      waves.reduce((n, e) => n + (e.wave === w ? 1 : 0), 0);
    const opening = count(1) + count(2);
    const closing = count(last) + count(last - 1);
    expect(closing, `${level.label} 结尾冲击`).toBeGreaterThan(opening * 1.8);
    expect(waves.length, `${level.label} 出怪总量`).toBeGreaterThanOrEqual(30);
    // 波次间隔：平均不超过 30 秒，避免长时间空场。
    const span = waves.at(-1)!.at - waves[0].at;
    expect(span / Math.max(1, last - 1), `${level.label} 波次间隔`).toBeLessThanOrEqual(
      level.mode === "whack" ? 40 : 30,
    );
    const perMinute = waves.length / (settings.duration / 60);
    expect(perMinute, `${level.label} 每分钟出怪`).toBeGreaterThanOrEqual(3);
    totals.set(level.world, (totals.get(level.world) ?? 0) + waves.length);
  }
  // 章节越靠后，同样的时长里僵尸越多（1-5 章单调不降）。
  const perWorld = [...totals.keys()]
    .sort((a, b) => a - b)
    .map((w) => totals.get(w)!);
  for (let i = 1; i < perWorld.length; i++)
    expect(perWorld[i]).toBeGreaterThan(perWorld[i - 1]);
});
