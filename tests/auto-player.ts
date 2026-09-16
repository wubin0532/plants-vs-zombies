import { Engine } from "../src/game/engine";
import { plantById, type Level } from "../src/game/content";

/**
 * 回归测试用的脚本玩家：模拟“会挑卡的普通玩家”。
 * 它只使用玩家在该关已经解锁的种子，卡槽数量与游戏内的槽位规则一致，
 * 并按经济／火力／防线／应急分配卡槽，因此可以当作难度变化的相对参考，
 * 但不代表人工通关验收。
 */
const ECONOMY = ["sunflower", "sunshroom", "twin"];
const SHOOTERS = [
  "fume",
  "repeater",
  "snowpea",
  "three",
  "star",
  "pea",
  "puff",
  "cactus",
  "cabbage",
  "kernel",
  "melon",
  "winter",
  "gloom",
  "gatling",
  "cattail",
  "split",
  "chomper",
];
const WALLS = ["wallnut", "tallnut", "pumpkin"];
const EMERGENCY = [
  "cherry",
  "jalapeno",
  "ice",
  "squash",
  "kelp",
  "blover",
  "magnet",
  "umbrella",
  "doom",
  "hypno",
  "spike",
  "garlic",
];
const FILLER = [
  ...ECONOMY,
  ...SHOOTERS,
  ...WALLS,
  ...EMERGENCY,
  "sea",
  "lantern",
  "grave",
  "coffee",
  "scaredy",
  "spikerock",
  "marigold",
];

export function autoCards(level: Level): string[] {
  // 关卡限定的玩法由游戏直接发种子，这里跟随对应卡池。
  if (level.mode === "bowling") return ["wallnut", "wallnut", "cherry"];
  if (level.mode === "boss")
    return ["cabbage", "kernel", "melon", "ice", "jalapeno", "pot"];
  const slots = Math.min(10, 6 + Math.floor((level.id - 1) / 10));
  const unlocked = (id: string) =>
    (plantById[id]?.unlock ?? Infinity) <= level.id;
  const out: string[] = [];
  const take = (ids: string[], quota: number) => {
    for (const id of ids) {
      if (quota <= 0) return;
      if (out.includes(id) || !unlocked(id)) continue;
      out.push(id);
      quota--;
    }
  };
  take(ECONOMY, 2);
  take(SHOOTERS, 4);
  take(WALLS, 2);
  if (level.scene === "roof") take(["pot"], 1);
  if (level.scene === "pool" || level.scene === "fog") take(["lily"], 1);
  take(EMERGENCY, 2);
  take(FILLER, slots - out.length);
  return out.slice(0, slots);
}

export function defend(e: Engine) {
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
  // 先补齐经济，再按“火力最薄的一行优先”铺开防线。
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
      // 花盆／睡莲只是铺地，留出买火力的钱再扩建，避免把经济全砸在地上。
      if (e.sun < d.cost + 100) continue;
      for (let c = 2; c < 6; c++)
        for (let r = 0; r < e.level.rows; r++)
          if (id === "pot" || e.water(r)) if (put(id, r, c)) return;
      continue;
    }
    if (["shooter", "shroom", "fume", "lob"].includes(d.kind)) {
      const rows = Array.from({ length: e.level.rows }, (_, i) => i).sort(
        (a, b) => rowPriority(e, a) - rowPriority(e, b),
      );
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

/** 有敌人逼近的行优先补种，其次按该行现有火力从少到多。 */
function rowPriority(e: Engine, row: number) {
  const threatened = e.zombies.some(
    (z) => !z.ally && z.hp > 0 && z.row === row && z.x < 7.5,
  );
  const firepower = e.plants
    .filter((p) => p.row === row && p.hp > 0 && !p.sleep)
    .reduce(
      (s, p) =>
        s + (plantById[p.id].damage ? 100 : 0) + plantById[p.id].cost,
      0,
    );
  return (threatened ? 0 : 400) + firepower;
}
