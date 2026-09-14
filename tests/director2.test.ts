import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { unitPrice } from "../src/game/director";

function slotsOf(e: Engine, wave: number) {
  return e.schedule.filter((s) => s.wave === wave).length;
}
function priceOf(plan: string[]) {
  return plan.reduce((s, id) => s + unitPrice[id], 0);
}
it("每波阵容不超槽位数且至少出 1 只，价目不超预算软上限", () => {
  const e = new Engine(8, [], 42);
  for (let w = 1; w <= e.totalWaves; w++) {
    const plan = e.composeWave(w);
    const slots = slotsOf(e, w);
    expect(plan.length).toBeGreaterThanOrEqual(1);
    expect(plan.length).toBeLessThanOrEqual(slots);
    const progress = (w - 1) / Math.max(1, e.totalWaves - 1);
    const unlocked = e.level.enemies.slice(
      0,
      Math.max(1, Math.ceil(e.level.enemies.length * Math.min(1, 0.3 + progress))),
    );
    const average =
      unlocked.reduce((s, id) => s + unitPrice[id], 0) / unlocked.length;
    expect(priceOf(plan)).toBeLessThanOrEqual(Math.ceil(slots * average) + 1);
  }
});
it("阵容兵种不超出本关敌人池（旗帜除外）", () => {
  const e = new Engine(48, [], 7);
  const allowed = new Set([...e.level.enemies, "flag"]);
  for (let w = 1; w <= e.totalWaves; w++)
    for (const id of e.composeWave(w)) expect(allowed.has(id)).toBe(true);
});
it("铁桶阵防线显著提高翻墙兵种的权重", () => {
  const sample = (fortify: boolean) => {
    const e = new Engine(48, [], 42);
    if (fortify)
      for (const r of [0, 1, 3, 4]) {
        e.addPlant("pea", r, 1);
        e.addPlant("pea", r, 2);
        e.addPlant("wallnut", r, 5);
      }
    let counter = 0,
      total = 0;
    for (let round = 0; round < 12; round++)
      for (const id of e.composeWave(e.totalWaves)) {
        total++;
        if (id === "ladder") counter++;
      }
    return counter / total;
  };
  const fortified = sample(true);
  const open = sample(false);
  expect(fortified).toBeGreaterThan(open * 1.5);
});
it("巨人出场后进入 2 波冷却", () => {
  const e = new Engine(48, [], 42);
  let gargWave = 0;
  for (let w = 1; w <= e.totalWaves && !gargWave; w++)
    if (e.composeWave(w).includes("garg")) gargWave = w;
  expect(gargWave).toBeGreaterThan(0);
  for (const w of [gargWave + 1, gargWave + 2])
    if (w <= e.totalWaves) expect(e.composeWave(w)).not.toContain("garg");
});
it("同种子两次运行阵容完全一致", () => {
  const run = () => {
    const e = new Engine(26, [], 99);
    const all: string[][] = [];
    for (let w = 1; w <= e.totalWaves; w++) {
      if (w === 3) e.addPlant("pea", 2, 2);
      if (w === 5) e.sun = 500;
      all.push(e.composeWave(w));
    }
    return JSON.stringify(all);
  };
  expect(run()).toBe(run());
});
it("经济碾压加码预算，新手保护下不加码", () => {
  const totals = (level: number, sun: number, difficulty?: string) => {
    const e = new Engine(
      level,
      [],
      42,
      difficulty ? { difficulty: difficulty as "casual" } : {},
    );
    e.sun = sun;
    let total = 0;
    for (let w = 1; w <= e.totalWaves; w++) total += priceOf(e.composeWave(w));
    return total;
  };
  expect(totals(8, 500)).toBeGreaterThan(totals(8, 0));
  expect(totals(1, 500)).toBe(totals(1, 0));
  expect(totals(8, 500, "casual")).toBe(totals(8, 0, "casual"));
});
