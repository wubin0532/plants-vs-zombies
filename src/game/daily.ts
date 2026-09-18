import {
  isMushroom,
  isNight,
  levels,
  plantById,
  plants,
  zombieById,
} from "./content";
import type { Level } from "./content";
import { battleSettings, type BattleOptions } from "./difficulty";
import type { Engine } from "./engine";

export type DailyModId =
  | "mower-loss"
  | "low-sun"
  | "sparse-sky-sun"
  | "dense-waves"
  | "tough-zombies"
  | "thin-deck"
  | "rich-sun"
  | "spare-mower"
  | "wide-deck"
  | "mono-zombies"
  | "always-weather";

/** 每日规则变体：同一种子固定，重抽时一起换。 */
export type DailyMod = {
  id: DailyModId;
  name: string;
  desc: string;
  tone: "bane" | "boon" | "twist";
  /** 幅度：阳光量 / 密度或血量加成 / 卡位数 / 秒数等。 */
  value: number;
  /** 受影响的关卡行（割草机类）。 */
  rows?: number[];
  /** 单一尸群的敌人名单。 */
  enemies?: string[];
  /** 常驻天气类型。 */
  weather?: "rain" | "wind";
};

export type DailyChallenge = {
  date: string;
  seed: number;
  levelId: number;
  cards: string[];
  mods: DailyMod[];
  /** 每日专属战斗设置：等价的 custom 基线 + 词缀。 */
  options: BattleOptions;
};

const BANE_POOL: DailyModId[] = [
  "mower-loss",
  "low-sun",
  "sparse-sky-sun",
  "dense-waves",
  "tough-zombies",
  "thin-deck",
];
const BOON_POOL: DailyModId[] = [
  "rich-sun",
  "spare-mower",
  "wide-deck",
  "always-weather",
];
const TWIST_POOL: DailyModId[] = ["mono-zombies"];

/**
 * 每日挑战统一使用完整基础卡池，不按冒险进度过滤。
 * 新手存档（unlocked=1）只解锁了豌豆，若按进度发卡就凑不出阳光经济，
 * 每日挑战会在第一次收阳光前直接卡死，所以这里刻意放开。
 * 排除升级卡与模仿者：升级卡依赖本体，模仿者需要真实卡池才能复制。
 */
// 每日挑战不掉金币，所以把产币的万寿菊也排除，避免发到废卡。
const BASE_PLANTS = plants.filter(
  (p) => !p.upgrade && p.id !== "imitater" && p.id !== "marigold",
);

/**
 * 每日卡的“时代上限”：只发这一关同期及稍后解锁的植物。
 * 否则第 1 关的僵尸会配上火炬树桩、玉米投手，植物强得没边。
 * 留 +2 的余量，保证早期关卡也能凑出 4~6 张可用卡。
 */
const eraCap = (level: Level) => Math.min(51, Math.max(6, level.id + 2));
const dailyPool = (level: Level): string[] =>
  BASE_PLANTS.filter((p) => p.unlock <= eraCap(level)).map((p) => p.id);

const ATTACK_KINDS = new Set([
  "electric",
  "shooter",
  "shroom",
  "lob",
  "homing",
  "fume",
  "gloom",
  "star",
  "spike",
]);

/**
 * 必须自带解法的机制僵尸：只靠堆伤害解决不了，
 * 卡池里必须给出对应克制，否则当天的关卡就是死局。
 */
const GATING_ENEMIES = new Set(["balloon", "digger", "snorkel", "zomboni"]);

const pad2 = (n: number) => String(n).padStart(2, "0");
const dateStr = (date: Date) =>
  `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;

/**
 * FNV-1a + splitmix32 收尾：把 "20260101" 这类高度相似的字符串
 * 打散成互不相关的 32 位种子。旧实现直接拿日期数字当 LCG 初值，
 * 第一发随机数在相邻日期只差约 4e-4，导致每日挑战的关卡连续
 * 几十天停在同一关（这正是“每天都不变”的根因）。
 */
function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0 || 1;
}

/** mulberry32：小、快、雪崩好，只用于每日生成，与战斗内 RNG 相互独立。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const attackWorks = (id: string, night: boolean, cards: string[]): boolean => {
  const def = plantById[id];
  if (!def || def.upgrade || !ATTACK_KINDS.has(def.kind)) return false;
  return night || !isMushroom(id) || cards.includes("coffee");
};

/** 场景相关性：别在陆地关卡塞睡莲/海蘑菇，也别在屋顶之外发花盆。 */
const sceneRelevant = (id: string, level: Level, cards: string[]): boolean => {
  if (
    ["lily", "kelp", "sea"].includes(id) &&
    !["pool", "fog"].includes(level.scene)
  )
    return false;
  if (id === "pot" && level.scene !== "roof") return false;
  if (id === "grave" && level.scene !== "night") return false;
  // 白天的蘑菇会休眠；没有咖啡豆唤醒就等同废卡，干脆不发。
  if (isMushroom(id) && !isNight(level.scene)) return cards.includes("coffee");
  if (id === "coffee")
    return !isNight(level.scene) && cards.some((c) => isMushroom(c));
  return true;
};

/**
 * 一局卡池是否“可打”：阳光经济、地形必需、至少一种可用火力、
 * 机制僵尸有对应克制。生成器与测试共用这一份判定。
 */
export function dailyPlayable(level: Level, cards: string[]): boolean {
  if (!cards.some((id) => plantById[id]?.kind === "sun")) return false;
  if (["pool", "fog"].includes(level.scene) && !cards.includes("lily"))
    return false;
  if (level.scene === "roof" && !cards.includes("pot")) return false;
  const night = isNight(level.scene);
  if (!cards.some((id) => attackWorks(id, night, cards))) return false;
  for (const enemy of level.enemies) {
    if (!GATING_ENEMIES.has(enemy)) continue;
    const counters = zombieById[enemy]?.counters ?? [];
    if (counters.length && !counters.some((c) => cards.includes(c)))
      return false;
  }
  return true;
}

/** 关卡按日期哈希选取，并尽量避开与昨天相同的一关。 */
function pickLevel(day: string, yesterday: string, unlocked: number): Level {
  // 关卡池：至少覆盖首个世界（10 关），最多到玩家进度，且只取普通关，
  // 保证反推出的卡池真的会用到。旧实现取 1..unlocked，新存档永远第 1 关。
  const cap = Math.min(50, Math.max(10, unlocked));
  const from = Math.max(1, cap - 19);
  const pool = levels.filter(
    (l) => l.id <= cap && l.id >= from && l.mode === "normal",
  );
  if (!pool.length) return levels[0];
  if (pool.length === 1) return pool[0];
  const raw = (text: string) =>
    Math.floor(rng(hashSeed(`${text}|level`))() * pool.length);
  let index = raw(day);
  if (index === raw(yesterday))
    index =
      (index + 1 + Math.floor(rng(hashSeed(`${day}|reroll`))() * (pool.length - 1))) %
      pool.length;
  return pool[index];
}

/** 造出一个具体词缀（含幅度、受影响的行/敌人）。 */
function makeMod(id: DailyModId, rand: () => number, level: Level): DailyMod {
  const rows = () =>
    shuffle(
      Array.from({ length: level.rows }, (_, r) => r),
      rand,
    );
  switch (id) {
    case "mower-loss": {
      const n = 1 + Math.floor(rand() * Math.min(3, Math.max(1, level.rows - 2)));
      const picked = rows().slice(0, n).sort((a, b) => a - b);
      return {
        id,
        name: "残缺防线",
        tone: "bane",
        value: n,
        rows: picked,
        desc: `第 ${picked.map((r) => r + 1).join("、")} 行没有割草机`,
      };
    }
    case "low-sun": {
      const v = [75, 100, 125][Math.floor(rand() * 3)];
      return {
        id,
        name: "阳光匮乏",
        tone: "bane",
        value: v,
        desc: `开局只有 ${v} 阳光`,
      };
    }
    case "sparse-sky-sun": {
      const v = 9 + Math.floor(rand() * 4);
      return {
        id,
        name: "阴云蔽日",
        tone: "bane",
        value: v,
        desc: `天降阳光约每 ${v} 秒一次`,
      };
    }
    case "dense-waves": {
      const v = 0.15 + rand() * 0.1;
      return {
        id,
        name: "尸潮汹涌",
        tone: "bane",
        value: v,
        desc: `波次密度 +${Math.round(v * 100)}%`,
      };
    }
    case "tough-zombies": {
      const v = 0.15 + rand() * 0.1;
      return {
        id,
        name: "强化尸群",
        tone: "bane",
        value: v,
        desc: `僵尸血量 +${Math.round(v * 100)}%、速度 +${Math.round(v * 50)}%`,
      };
    }
    case "thin-deck": {
      const v = 1 + Math.floor(rand() * 2);
      return { id, name: "精简卡组", tone: "bane", value: v, desc: `卡槽 -${v}` };
    }
    case "rich-sun": {
      const v = 75 + Math.floor(rand() * 3) * 25;
      return {
        id,
        name: "丰收之年",
        tone: "boon",
        value: v,
        desc: `开局额外 +${v} 阳光`,
      };
    }
    case "spare-mower": {
      const n = 1 + Math.floor(rand() * 2);
      const picked = rows().slice(0, n).sort((a, b) => a - b);
      return {
        id,
        name: "备用推车",
        tone: "boon",
        value: n,
        rows: picked,
        desc: `第 ${picked.map((r) => r + 1).join("、")} 行多一台小推车`,
      };
    }
    case "wide-deck":
      return { id, name: "加宽卡组", tone: "boon", value: 1, desc: "卡槽 +1" };
    case "always-weather": {
      const weather = rand() < 0.5 ? "rain" : "wind";
      return {
        id,
        name: weather === "rain" ? "阳光雨" : "寒风",
        tone: "boon",
        value: 0,
        weather,
        desc: weather === "rain" ? "阳光雨反复降临" : "寒风反复过境，僵尸持续减速",
      };
    }
    case "mono-zombies": {
      // 机制僵尸必须保留，否则卡池的克制就没意义了。
      const gating = level.enemies.filter((e) => GATING_ENEMIES.has(e));
      const others = shuffle(
        level.enemies.filter((e) => e !== "basic" && !GATING_ENEMIES.has(e)),
        rand,
      );
      const picked = Array.from(new Set(["basic", ...gating, ...others])).slice(0, 3);
      return {
        id,
        name: "单一尸群",
        tone: "twist",
        value: picked.length,
        enemies: picked,
        desc: `今天只出现 ${picked.map((e) => zombieById[e]?.name ?? e).join("、")}`,
      };
    }
  }
  throw new Error(`未知词缀 ${id}`);
}

/** 互斥词缀：加宽/精简卡组、丰收/匮乏不能同时出现。 */
function conflicts(id: DailyModId, mods: DailyMod[]): boolean {
  const has = (x: DailyModId) => mods.some((m) => m.id === x);
  if (id === "wide-deck") return has("thin-deck");
  if (id === "rich-sun") return has("low-sun");
  return false;
}

/**
 * 标准档：每天 1~2 个负面；30% 概率配 1 个正面；另有 20% 概率来个主题日。
 * 全部由同一种子决定，所以官方种子与“换一局”都会稳定复现。
 */
function pickMods(seed: number, level: Level): DailyMod[] {
  const rand = rng(hashSeed(`${seed}|mods`));
  const mods: DailyMod[] = [];
  const banes = shuffle(BANE_POOL, rand);
  const count = 1 + (rand() < 0.4 ? 1 : 0);
  for (let i = 0; i < count && i < banes.length; i++)
    mods.push(makeMod(banes[i], rand, level));
  if (rand() < 0.3) {
    const boons = shuffle(BOON_POOL, rand).filter((id) => !conflicts(id, mods));
    if (boons.length) mods.push(makeMod(boons[0], rand, level));
  }
  if (rand() < 0.2) mods.push(makeMod(TWIST_POOL[0], rand, level));
  return mods;
}

/** 把词缀折算成战斗设置；基线就是标准难度，只是改用 custom 精确接管。 */
export function dailyOptions(level: Level, mods: DailyMod[]): BattleOptions {
  const standard = battleSettings(level, { difficulty: "standard" });
  const options: BattleOptions = {
    difficulty: "custom",
    minutes: standard.duration / 60,
    density: 1,
    health: 1,
    speed: 1,
    sun: 150,
    prep: 25,
    mowers: true,
  };
  for (const mod of mods) {
    if (mod.id === "low-sun") options.sun = mod.value;
    else if (mod.id === "rich-sun") options.sun = 150 + mod.value;
    else if (mod.id === "dense-waves") options.density = 1 + mod.value;
    else if (mod.id === "tough-zombies") {
      options.health = 1 + mod.value;
      options.speed = 1 + mod.value / 2;
    }
  }
  return options;
}

/** 引擎建好后应用词缀；割草机保底留 2 行。 */
export function applyDailyMods(engine: Engine, mods: DailyMod[]): void {
  // 每日挑战不产金币、不结算进商店：关掉所有金币掉落与黄金僵尸。
  engine.coinDrops = false;
  engine.goldenChance = 0;
  for (const mod of mods) {
    switch (mod.id) {
      case "mower-loss":
        for (const row of mod.rows ?? []) {
          if (engine.mowers.filter(Boolean).length <= 2) break;
          if (engine.mowers[row]) engine.mowers[row] = false;
        }
        break;
      case "spare-mower":
        for (const row of mod.rows ?? [])
          if (row < engine.spareMowers.length) engine.spareMowers[row] = true;
        break;
      case "sparse-sky-sun":
        engine.setSkySunInterval(mod.value);
        break;
      case "always-weather":
        engine.eventAt = 6;
        engine.eventKind = mod.weather ?? "rain";
        engine.weatherLoop = true;
        break;
      case "mono-zombies":
        if (mod.enemies?.length) engine.level.enemies = [...mod.enemies];
        break;
    }
  }
}

/**
 * 反推式配装：先看这一关会出哪些机制僵尸，再据此凑出能打又每天不同的卡池。
 * 骨架（阳光 / 地形 / 火力 / 机制克制）完全由关卡决定，
 * 弹性槽位由当日种子决定，所以同一天确定、不同天有变化。
 * “精简/加宽卡组”词缀只改最终张数，不会破坏可打性。
 */
function buildCards(level: Level, seed: number, mods: DailyMod[]): string[] {
  const rand = rng(hashSeed(`${seed}|cards`));
  const night = isNight(level.scene);
  const pool = dailyPool(level);
  const cards: string[] = [night ? "sunshroom" : "sunflower"];
  const push = (id: string) => {
    if (id && !cards.includes(id)) cards.push(id);
  };

  // 地形支撑：泳池/浓雾必须有睡莲，屋顶必须有花盆。
  if (["pool", "fog"].includes(level.scene)) push("lily");
  if (level.scene === "roof") push("pot");

  // 机制克制：多个候选时由当日种子决定，保证每天解同一种僵尸的答案不同。
  for (const enemy of level.enemies) {
    if (!GATING_ENEMIES.has(enemy)) continue;
    const counters = zombieById[enemy]?.counters ?? [];
    if (counters.some((id) => cards.includes(id))) continue;
    const options = counters.filter(
      (id) =>
        pool.includes(id) && !cards.includes(id) && sceneRelevant(id, level, cards),
    );
    if (!options.length) continue;
    const chosen = options[Math.floor(rand() * options.length)];
    push(chosen);
    // 若非得靠蘑菇解决（白天会休眠），必须同时补上咖啡豆。
    if (isMushroom(chosen) && !night) push("coffee");
  }

  // 保底火力：白天若只剩休眠蘑菇又没有咖啡豆，卡池仍是死局。
  if (!cards.some((id) => attackWorks(id, night, cards))) {
    const options = pool.filter(
      (id) =>
        !cards.includes(id) &&
        attackWorks(id, night, cards) &&
        sceneRelevant(id, level, cards),
    );
    if (options.length) push(options[Math.floor(rand() * options.length)]);
  }

  // 弹性槽位：默认 6~8 张，再叠加卡组词缀（下限 4、上限 8）。
  let target = 6 + Math.floor(rand() * 3);
  for (const mod of mods) {
    if (mod.id === "thin-deck") target -= mod.value;
    else if (mod.id === "wide-deck") target += 1;
  }
  target = Math.min(8, Math.max(4, Math.max(cards.length, target)));
  while (cards.length < target) {
    const outside = pool.filter(
      (id) => !cards.includes(id) && sceneRelevant(id, level, cards),
    );
    if (!outside.length) break;
    const kinds = new Set(cards.map((id) => plantById[id].kind));
    const fresh = outside.filter((id) => !kinds.has(plantById[id].kind));
    const from = fresh.length ? fresh : outside;
    push(from[Math.floor(rand() * from.length)]);
  }

  // 极端情况下必需卡超过 8 张：只裁掉不影响“可打”的卡，保证上限。
  while (cards.length > 8) {
    const index = cards.findIndex(
      (_, i) => i > 0 && dailyPlayable(level, cards.filter((__, j) => j !== i)),
    );
    if (index < 0) break;
    cards.splice(index, 1);
  }
  return cards;
}

export function dailyChallenge(
  date: Date,
  unlocked: number,
  salt = 0,
): DailyChallenge {
  const day = dateStr(date);
  const yesterday = dateStr(
    new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1),
  );
  // salt = 0 是官方每日种子（用于最佳成绩）；salt > 0 是“换一局”随机重抽。
  const key = salt === 0 ? day : `${day}#${salt >>> 0}`;
  const prevKey = salt === 0 ? yesterday : `${yesterday}#${salt >>> 0}`;
  const level = pickLevel(key, prevKey, unlocked);
  const seed = hashSeed(key);
  const mods = pickMods(seed, level);
  return {
    date: day,
    seed,
    levelId: level.id,
    cards: buildCards(level, seed, mods),
    mods,
    options: dailyOptions(level, mods),
  };
}
