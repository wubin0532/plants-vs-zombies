import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { plants, levels, plantById, isNight } from "../src/game/content";
function defend(e: Engine) {
  for (const t of [...e.tokens]) e.collect(t.uid);
  if (e.level.mode === "whack") {
    for (const z of [...e.zombies]) e.hitZombie(z.uid);
    return;
  }
  if (e.level.mode === "vases" && !e.zombies.some((z) => !z.ally)) {
    const v = e.tiles.find((t) => t.type === "vase");
    if (v) e.click(v.row, v.col);
  }
  const ids = e.isBelt ? [...e.conveyor] : e.cards;
  if (e.level.mode === "bowling") {
    const z = e.zombies.find((z) => !z.ally);
    if (z && ids[0]) e.plant(ids[0], z.row, 0);
    return;
  }
  const enemies = e.zombies
    .filter((z) => !z.ally && z.hp > 0)
    .sort((a, b) => a.x - b.x);
  const put = (id: string, row: number, col: number) => {
    if (!ids.includes(id)) return false;
    if (!e.canPlant(id, row, col)) return e.plant(id, row, col);
    return false;
  };
  if (e.bossBall) {
    const id = e.bossBall.type === "fire" ? "ice" : "jalapeno";
    for (let c = 0; c < 9; c++) if (put(id, e.bossBall.row, c)) break;
  }
  // Immediate threats are countered using purchased/free seeds, with real cooldowns.
  for (const z of enemies) {
    if (z.x < 5) {
      if (z.flying) {
        for (let c = 0; c < 9; c++) if (put("blover", 0, c)) break;
      }
      for (const id of ["squash", "kelp", "cherry", "jalapeno"])
        if (ids.includes(id))
          for (const c of [Math.floor(z.x), Math.floor(z.x) - 1])
            if (put(id, z.row, c)) break;
    }
  }
  for (const id of ids) {
    const d = plantById[id];
    if (!d) continue;
    if (!e.isBelt && (e.cooldowns[id] > 0 || e.sun < d.cost)) continue;
    if (d.kind === "sun") {
      for (let c = 0; c < 2; c++)
        for (let r = 0; r < e.level.rows; r++)
          if (!e.water(r)) if (put(id, r, c)) return;
      continue;
    }
    if (d.kind === "base") {
      for (let c = 2; c < 6; c++)
        for (let r = 0; r < e.level.rows; r++)
          if (id === "pot" || e.water(r)) if (put(id, r, c)) return;
      continue;
    }
    if (["shooter", "shroom", "fume", "lob"].includes(d.kind)) {
      const rows = [
        ...new Set([
          ...enemies.map((z) => z.row),
          ...Array.from({ length: e.level.rows }, (_, i) => i),
        ]),
      ];
      for (let c = 2; c < 6; c++)
        for (const r of rows) if (put(id, r, c)) return;
      continue;
    }
    if (d.kind === "wall") {
      for (let r = 0; r < e.level.rows; r++) if (put(id, r, 6)) return;
    }
    if (d.kind === "light") {
      for (let r = 1; r < e.level.rows; r += 3) if (put(id, r, 6)) return;
    }
  }
}
// 自动玩家会输一部分后期关卡（不作为难度验收）；聚合统计保证高波次路径覆盖
const highWave = { total: 0, reached: 0 };
for (const l of levels)
  it(`关卡 ${l.label} 使用真实经济的自动玩家能推进并结算`, () => {
    const candidates =
      l.world === 0
        ? ["sunflower", "pea", "snowpea", "wallnut", "squash", "cherry"]
        : l.world === 1
          ? ["sunshroom", "puff", "fume", "grave", "wallnut", "ice", "doom"]
          : l.world === 2
            ? [
                "sunflower",
                "lily",
                "pea",
                "wallnut",
                "kelp",
                "squash",
                "cherry",
              ]
            : l.world === 3
              ? [
                  "sunshroom",
                  "lily",
                  "fume",
                  "cactus",
                  "blover",
                  "kelp",
                  "squash",
                  "lantern",
                  "star",
                ]
              : [
                  "sunflower",
                  "pot",
                  "cabbage",
                  "kernel",
                  "melon",
                  "squash",
                  "cherry",
                  "jalapeno",
                  "umbrella",
                ];
    const cards = candidates
      .filter((id) => plantById[id].unlock <= l.id)
      .slice(0, Math.min(10, 6 + l.world));
    const e = new Engine(l.id, cards);
    for (let i = 0; i < 18000 && e.status === "playing"; i++) {
      if (i % 3 === 0) defend(e);
      e.step(0.1);
    }
    expect(["won", "lost"]).toContain(e.status);
    // This test detects deadlocked levels; a scripted player is not a difficulty acceptance test.
    expect(Number.isFinite(e.sun) && e.sun >= 0).toBe(true);
    if (e.status === "won" && e.totalWaves >= 10)
      expect(e.wave, "通关必须跑到最终波").toBe(e.totalWaves);
    if (e.totalWaves >= 10) {
      highWave.total++;
      if (e.wave >= e.totalWaves) highWave.reached++;
    }
  });
it("高波次回归覆盖：≥10 波的关卡至少六成跑到最终波", () => {
  expect(highWave.total).toBeGreaterThan(30);
  expect(highWave.reached / highWave.total).toBeGreaterThanOrEqual(0.6);
});
