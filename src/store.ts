import {
  defaultOptions,
  normalizeOptions,
  type BattleOptions,
} from "./game/difficulty";
import { defineStore, getActivePinia } from "pinia";
import { useAuth } from "./auth";
import { ApiError, api } from "./api";
import {
  GUEST_PROFILE,
  LEGACY_SAVE_KEY,
  LEGACY_SYNCED_KEY,
  saveKeyFor,
  setLiveProfileReader,
  syncedAtKeyFor,
  writeActiveProfile,
} from "./save-keys";
export type Save = {
  version: 2;
  tutorialSeen: string[];
  unlocked: number;
  completed: number[];
  coins: number;
  sound: boolean;
  volume: number;
  mix: { battle: number; music: number; environment: number; ui: number };
  quality: "low" | "medium" | "high";
  shake: boolean;
  stars: Record<number, number>;
  lossStreak: Record<number, number>;
  daily: { date: string; best: number };
  achievements: string[];
  items: Record<string, number>;
  /**
   * 消耗型资源的单调计数，用于云同步合并。
   *
   * coins / items 会随消费**减少**，只对余额取 max 会把已花掉的金币和已用掉的
   * 道具从旧快照里凭空复活。因此两者各自额外记录只增不减的累计获得与累计消耗：
   *   余额 = 累计获得 − 累计消耗
   * 合并时两项分别取 max，余额据此回推。只记其中一项都不够：仅记「获得」时，
   * 旧快照的余额会被误当作「获得」（无法区分「没赚到」和「已花掉」）。
   * 缺省为 0 表示该档没有记账（v1 / 旧 v2），此时退化为 max(余额) 的旧行为。
   */
  coinsEarned: number;
  coinsSpent: number;
  itemsEarned: Record<string, number>;
  itemsSpent: Record<string, number>;
  seedSlots: number;
  kills: number;
  contrast: boolean;
  fontSize: "small" | "standard" | "large";
  options: BattleOptions;
  scores: {
    level: number;
    difficulty: string;
    seconds: number;
    settings: string;
  }[];
};
export type CloudState = "idle" | "syncing" | "synced" | "error";
export const initial = (): Save => ({
  version: 2,
  tutorialSeen: [],
  unlocked: 1,
  completed: [],
  coins: 0,
  sound: true,
  volume: 0.65,
  mix: { battle: 1, music: 0.25, environment: 0.3, ui: 0.65 },
  quality: "high",
  shake: true,
  stars: {},
  lossStreak: {},
  daily: { date: "", best: 0 },
  achievements: [],
  items: {},
  coinsEarned: 0,
  coinsSpent: 0,
  itemsEarned: {},
  itemsSpent: {},
  seedSlots: 0,
  kills: 0,
  contrast: false,
  fontSize: "standard",
  options: defaultOptions(),
  scores: [],
});
/**
 * 过滤「id → 正整数」计数表：丢掉非正整数、非法 id 与超上限的项。
 * 物品余额与累计获得共用，仅上限不同。
 */
function sanitizeCounters(raw: unknown, max: number): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([id, n]) =>
        id !== "ice-start" &&
        Number.isInteger(n) &&
        (n as number) > 0 &&
        (n as number) <= max,
    ) as [string, number][],
  );
}

export function validateSave(data: unknown): Save {
  const version = (data as { version?: unknown })?.version;
  const d = data as Save;
  if (
    !d ||
    (version !== 1 && version !== 2) ||
    !Number.isInteger(d.unlocked) ||
    d.unlocked < 1 ||
    d.unlocked > 51 ||
    !Array.isArray(d.completed) ||
    d.completed.some((n) => !Number.isInteger(n) || n < 1 || n > 50) ||
    !Number.isInteger(d.coins) ||
    d.coins < 0 ||
    typeof d.sound !== "boolean"
  )
    throw Error("存档格式不正确，未覆盖当前进度");
  const complete = [...new Set(d.completed)].sort((a, b) => a - b);
  if (
    complete.some((v, i) => v !== i + 1) ||
    d.unlocked !== Math.min(51, complete.length + 1)
  )
    throw Error("存档进度不完整，未覆盖当前进度");
  // v1 → v2 迁移：v2 新增字段全部由下面的宽松校验补默认值。
  // 余额与累计获得都需要在返回前算好，因为累计获得有「不小于余额」的不变量。
  const items = sanitizeCounters(d.items, 99);
  // 累计获得 / 累计消耗单独过滤（上限放宽），并保证不变量：
  // itemsEarned >= items（余额不能超过累计获得）、itemsSpent <= itemsEarned。
  const itemsEarnedRaw = sanitizeCounters(d.itemsEarned, 100000);
  const itemsSpentRaw = sanitizeCounters(d.itemsSpent, 100000);
  const itemsEarned: Record<string, number> = {};
  const itemsSpent: Record<string, number> = {};
  for (const id of new Set([
    ...Object.keys(items),
    ...Object.keys(itemsEarnedRaw),
    ...Object.keys(itemsSpentRaw),
  ])) {
    const spent = Math.min(
      itemsSpentRaw[id] ?? 0,
      Math.max(items[id] ?? 0, itemsEarnedRaw[id] ?? 0),
    );
    const earned = Math.max(
      items[id] ?? 0,
      itemsEarnedRaw[id] ?? 0,
      spent,
    );
    if (spent > 0) itemsSpent[id] = spent;
    if (earned > 0) itemsEarned[id] = earned;
  }
  // 余额 = 获得 − 消耗；非法记账（消耗 > 获得）时把获得抬到消耗与余额之上。
  const coinsSpent =
    Number.isInteger(d.coinsSpent) && d.coinsSpent >= 0 ? d.coinsSpent : 0;
  const coinsEarned =
    Number.isInteger(d.coinsEarned) && d.coinsEarned >= 0
      ? Math.max(d.coinsEarned, d.coins, coinsSpent)
      : 0;
  return {
    ...d,
    version: 2,
    completed: complete,
    tutorialSeen: Array.isArray(d.tutorialSeen) ? [...new Set(d.tutorialSeen.filter((v) => typeof v === "string"))].slice(0, 30) : [],
    mix: Object.fromEntries(
      Object.entries(initial().mix).map(([key, value]) => [
        key,
        typeof d.mix?.[key as keyof Save["mix"]] === "number" &&
        Number.isFinite(d.mix[key as keyof Save["mix"]])
          ? Math.max(0, Math.min(1, d.mix[key as keyof Save["mix"]]))
          : value,
      ]),
    ) as Save["mix"],
    volume:
      typeof d.volume === "number" && Number.isFinite(d.volume)
        ? Math.max(0, Math.min(1, d.volume))
        : 0.65,
    quality: ["low", "medium", "high"].includes(d.quality) ? d.quality : "high",
    shake: typeof d.shake === "boolean" ? d.shake : true,
    stars:
      d.stars && typeof d.stars === "object"
        ? Object.fromEntries(
            Object.entries(d.stars).filter(
              ([level, n]) =>
                Number.isInteger(Number(level)) &&
                Number(level) >= 1 &&
                Number(level) <= 50 &&
                Number.isInteger(n) &&
                n >= 0 &&
                n <= 3,
            ),
          )
        : {},
    lossStreak:
      d.lossStreak && typeof d.lossStreak === "object"
        ? Object.fromEntries(
            Object.entries(d.lossStreak).filter(
              ([level, n]) =>
                Number.isInteger(Number(level)) &&
                Number(level) >= 1 &&
                Number(level) <= 50 &&
                Number.isInteger(n) &&
                n >= 0 &&
                n <= 99,
            ),
          )
        : {},
    daily:
      d.daily &&
      typeof d.daily === "object" &&
      typeof d.daily.date === "string" &&
      Number.isFinite(d.daily.best) &&
      d.daily.best >= 0
        ? { date: d.daily.date, best: d.daily.best }
        : { date: "", best: 0 },
    achievements: Array.isArray(d.achievements)
      ? [...new Set(d.achievements.filter((a) => typeof a === "string"))]
      : [],
    items: items,
    // 累计获得 / 累计消耗必须是非负整数，且满足 余额 ≤ 获得、消耗 ≤ 获得。
    coinsEarned,
    coinsSpent,
    itemsEarned,
    itemsSpent,
    seedSlots:
      Number.isInteger(d.seedSlots) && d.seedSlots >= 0 && d.seedSlots <= 10
        ? d.seedSlots
        : 0,
    kills: Number.isInteger(d.kills) && d.kills >= 0 ? d.kills : 0,
    contrast: typeof d.contrast === "boolean" ? d.contrast : false,
    fontSize: ["small", "standard", "large"].includes(d.fontSize)
      ? d.fontSize
      : "standard",
    options: normalizeOptions(d.options),
    scores: Array.isArray(d.scores)
      ? d.scores
          .filter(
            (s) =>
              s &&
              Number.isInteger(s.level) &&
              s.level >= 1 &&
              s.level <= 50 &&
              ["casual", "standard", "hard", "custom"].includes(s.difficulty) &&
              Number.isFinite(s.seconds) &&
              s.seconds >= 0 &&
              typeof s.settings === "string",
          )
          .slice(-200)
      : [],
  };
}

/** 进度排序：只用于决定合并后的主档（进度是单调的，不会回退）。 */
export function progressRank(s: Save): number {
  return (s.completed?.length ?? 0) * 1000 + (s.unlocked ?? 0);
}

/**
 * 云同步冲突合并：两端的进度取并集，永远不丢关卡进度。
 * 两个合法存档的 completed 都是从 1 开始的连续区间，因此取更长的一个即可。
 */
export function mergeSave(a: Save, b: Save): Save {
  return mergeCore(a, b, undefined);
}

/**
 * 同机两份存档的进度合并内核。
 *
 * keep 给出「界面偏好以谁为准」：音量 / 画质 / 字体等设置不是单调量，
 * 按进度排名取一侧会得到与操作顺序相关的怪异结果，因此持久化路径显式传入
 * 当前内存档作为 keep，让本地设置覆盖另一侧。
 */
function mergeCore(a: Save, b: Save, keep: Save | undefined): Save {
  const base = progressRank(a) >= progressRank(b) ? a : b;
  const completed = base.completed;
  const unlocked = Math.min(51, Math.max(base.unlocked, completed.length + 1));
  const stars: Record<number, number> = {};
  for (const level of new Set([
    ...Object.keys(a.stars ?? {}),
    ...Object.keys(b.stars ?? {}),
  ])) {
    const n = Number(level);
    stars[n] = Math.max(a.stars?.[n] ?? 0, b.stars?.[n] ?? 0);
  }
  // 消耗型资源：余额 = 累计获得 − 累计消耗，两项都只增不减。
  // 只对余额取 max 会把已花掉的金币 / 已用掉的道具从旧快照里复活；只记「获得」
  // 也不够，因为旧快照的余额会被误当成「获得」（无法区分「没赚到」和「已花掉」）。
  // 消耗是**事实**：两侧记到的是同一批支出，取较大者；获得同样只增不减取较大者；
  // 余额回推为 获得 − 消耗。没有任何一侧记过账（coinsEarned / itemsEarned 为 0 的
  // v1 / 旧 v2 档）时，该侧的余额同时充当「获得」，退化为旧的 max(余额) 行为。
  const aEarned = a.coinsEarned > 0 ? a.coinsEarned : a.coins;
  const bEarned = b.coinsEarned > 0 ? b.coinsEarned : b.coins;
  const coinsEarned = Math.max(aEarned, bEarned);
  const coinsSpent = Math.max(a.coinsSpent ?? 0, b.coinsSpent ?? 0);
  const coins = Math.max(0, coinsEarned - coinsSpent);
  const itemsEarned: Record<string, number> = {};
  const itemsSpent: Record<string, number> = {};
  const items: Record<string, number> = {};
  for (const id of new Set([
    ...Object.keys(a.items ?? {}),
    ...Object.keys(b.items ?? {}),
    ...Object.keys(a.itemsEarned ?? {}),
    ...Object.keys(b.itemsEarned ?? {}),
    ...Object.keys(a.itemsSpent ?? {}),
    ...Object.keys(b.itemsSpent ?? {}),
  ])) {
    const aBalance = a.items?.[id] ?? 0;
    const bBalance = b.items?.[id] ?? 0;
    const spent = Math.max(a.itemsSpent?.[id] ?? 0, b.itemsSpent?.[id] ?? 0);
    // 余额兜底即「没有记账的一侧把余额当作获得」。
    const earned = Math.max(
      aBalance,
      bBalance,
      a.itemsEarned?.[id] ?? 0,
      b.itemsEarned?.[id] ?? 0,
    );
    const balance = Math.max(0, earned - spent);
    if (spent > 0) itemsSpent[id] = spent;
    if (earned > 0) itemsEarned[id] = earned;
    if (balance > 0) items[id] = balance;
  }
  const daily =
    a.daily.date === b.daily.date
      ? {
          date: a.daily.date,
          best: Math.min(
            a.daily.best > 0 ? a.daily.best : Infinity,
            b.daily.best > 0 ? b.daily.best : Infinity,
          ),
        }
      : a.daily.date > b.daily.date
        ? a.daily
        : b.daily;
  const merged: Save = {
    ...base,
    version: 2,
    completed,
    unlocked,
    coins,
    coinsEarned,
    coinsSpent,
    kills: Math.max(a.kills, b.kills),
    seedSlots: Math.max(a.seedSlots, b.seedSlots),
    stars,
    items,
    itemsEarned,
    itemsSpent,
    achievements: [...new Set([...a.achievements, ...b.achievements])],
    tutorialSeen: [...new Set([...a.tutorialSeen, ...b.tutorialSeen])].slice(0, 30),
    scores: [...a.scores, ...b.scores].slice(-200),
    daily: Number.isFinite(daily.best) ? daily : { date: daily.date, best: 0 },
  };
  // 偏好类字段：显式 keep 时以本地为准，否则沿用 base（与原行为一致）。
  if (keep)
    Object.assign(merged, {
      sound: keep.sound,
      volume: keep.volume,
      mix: { ...keep.mix },
      quality: keep.quality,
      shake: keep.shake,
      contrast: keep.contrast,
      fontSize: keep.fontSize,
      options: keep.options,
    });
  return validateSave(merged);
}

let pushTimer: number | undefined;
let suppressPush = false;

/** 判断一份存档是否含有值得"带入账号"的真实进度（空档不算）。 */
export function hasProgress(save: Save): boolean {
  return (
    save.completed.length > 0 ||
    save.unlocked > 1 ||
    save.coins > 0 ||
    save.seedSlots > 0 ||
    save.kills > 0 ||
    save.achievements.length > 0 ||
    Object.keys(save.stars).length > 0 ||
    Object.keys(save.items).length > 0 ||
    save.scores.length > 0
  );
}

/** 只读取某归属的本机档（校验通过才返回），不改变当前 store 状态。 */
function readProfile(profile: string): Save | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(saveKeyFor(profile));
    if (!raw) return null;
    return validateSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 首次加载访客档时，把旧版全局存档迁移为访客档；旧 key 保留作兜底。 */
function migrateLegacyToGuest() {
  try {
    if (localStorage.getItem(saveKeyFor(GUEST_PROFILE))) return;
    const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
    if (legacy) localStorage.setItem(saveKeyFor(GUEST_PROFILE), legacy);
    const legacySynced = localStorage.getItem(LEGACY_SYNCED_KEY);
    if (legacySynced)
      localStorage.setItem(syncedAtKeyFor(GUEST_PROFILE), legacySynced);
  } catch {
    /* 迁移失败不阻塞启动 */
  }
}
/** 基础卡槽数；6→10 全部由商店扩容承担，不再随章节免费增加。 */
export const BASE_SEED_SLOTS = 6;
export const MAX_SEED_SLOTS = 10;
export const MAX_SEED_SLOT_PURCHASES = MAX_SEED_SLOTS - BASE_SEED_SLOTS;
export const totalSeedSlots = (seedSlots: number) =>
  Math.min(
    MAX_SEED_SLOTS,
    BASE_SEED_SLOTS + Math.max(0, Math.trunc(seedSlots)),
  );
/** 第 N 次扩容的价格，越升越贵；第 4 次之后已满级。 */
const SEED_SLOT_PRICES = [600, 1400, 2800, 4800];
export const seedSlotPriceFor = (seedSlots: number) =>
  SEED_SLOT_PRICES[seedSlots] ??
  SEED_SLOT_PRICES[SEED_SLOT_PRICES.length - 1];
// store 挂载后，本标签页的权威归属是内存里的 profile；把它登记给 save-keys，
// 让 replay.ts 等纯读取方不再依赖可能被别的标签页改写的 localStorage。
setLiveProfileReader(() => {
  if (!getActivePinia()) return undefined;
  return useSave().profile;
});
export const useSave = defineStore("save", {
  state: () => ({
    data: initial(),
    warning: "",
    cloud: "idle" as CloudState,
    /** 本机已见到的服务端修订号（乐观并发的 base），持久化以跨刷新保留。 */
    cloudAt: 0,
    /** 是否已完成登录/恢复后的首次对账；未完成前禁止云推送。 */
    reconciled: false,
    /**
     * 当前本机档归属：guest 或登录用户 id。
     * 本机存档按此分槽；任何云推送都要求 profile === auth.user.id，杜绝串档。
     */
    profile: GUEST_PROFILE,
    /** 新账号云端为空、且访客档有进度时，等待用户选择是否带入。 */
    claim: null as { guest: Save } | null,
  }),
  actions: {
    /** 载入指定归属的本机档；不存在则空档起步，绝不沿用上一个账号的内存数据。 */
    load(profile: string = GUEST_PROFILE) {
      // 切换归属前先把上一个归属的内存进度落回它自己的槽。
      // 否则「改了设置但没触发写入就切号」会让那次改动丢失；
      // 更不能把它写进新归属的槽（那才是跨账号泄漏）。
      if (
        profile !== this.profile &&
        this.profile !== GUEST_PROFILE &&
        typeof localStorage !== "undefined"
      ) {
        try {
          const stored = readProfile(this.profile);
          const next = stored
            ? mergeCore(this.data, stored, this.data)
            : this.data;
          localStorage.setItem(
            saveKeyFor(this.profile),
            JSON.stringify(next),
          );
        } catch {
          /* 落盘失败不阻塞切换 */
        }
      }
      this.profile = profile;
      writeActiveProfile(profile);
      this.claim = null;
      if (typeof localStorage === "undefined") {
        this.reconciled = false;
        return;
      }
      if (profile === GUEST_PROFILE) migrateLegacyToGuest();
      try {
        const raw = localStorage.getItem(saveKeyFor(profile));
        if (raw) this.data = validateSave(JSON.parse(raw));
        else this.data = initial();
      } catch {
        // 必须真正重置内存态：只写 warning 会让上一个账号的进度残留在
        // this.data 里，随后一次 persist() 就把它写进当前归属的槽位（跨账号泄漏）。
        this.data = initial();
        this.cloudAt = 0;
        this.warning =
          "本地存档损坏，进度已重置。如有备份，可在设置中导入恢复。";
      }
      try {
        const synced =
          Number(localStorage.getItem(syncedAtKeyFor(profile)) ?? 0) || 0;
        this.cloudAt = Number.isFinite(synced) ? synced : 0;
      } catch {
        this.cloudAt = 0;
      }
      this.reconciled = false;
    },
    /**
     * 写入本归属的存档槽。
     *
     * 默认走「读-合并-写」：另一个标签页可能已经写下更新的进度，整快照盲写会把
     * 它覆盖掉（访客档没有云端兜底，覆盖即永久丢失）。合并时界面偏好以内存为准。
     * force 用于用户显式要求的覆盖（导入存档），此时不做合并，直接落盘。
     */
    persist(force = false) {
      try {
        let next = this.data;
        if (!force) {
          const stored = readProfile(this.profile);
          if (stored) next = mergeCore(this.data, stored, this.data);
        }
        this.data = next;
        localStorage.setItem(saveKeyFor(this.profile), JSON.stringify(next));
      } catch {
        this.warning = "浏览器未能保存进度，请导出存档备份。";
      }
      this.scheduleCloudPush();
    },
    /**
     * 另一个标签页写入了本归属的存档时重载内存态。
     *
     * 与 persist() 的读-合并-写互补：合并只在「本标签页恰好要写」时发生，
     * 若本标签页一直不动，仍会停留在旧进度上并可能在下一次写入时把对方回退。
     * 这里在收到 storage 事件时立即对齐，且因为是合并而非覆盖，不会丢任何一侧。
     */
    reloadFromStorage() {
      if (typeof localStorage === "undefined") return;
      const stored = readProfile(this.profile);
      if (!stored) return;
      const merged = mergeCore(this.data, stored, this.data);
      if (JSON.stringify(merged) === JSON.stringify(this.data)) return;
      suppressPush = true;
      try {
        this.data = merged;
      } finally {
        suppressPush = false;
      }
    },
    scheduleCloudPush() {
      if (!getActivePinia() || suppressPush) return;
      if (!this.reconciled) return;
      const auth = useAuth(getActivePinia()!);
      // 只允许把当前账号自己的档推到自己名下，杜绝切号后串档。
      if (!auth.loggedIn || auth.user?.id !== this.profile) return;
      if (typeof window === "undefined") return;
      clearTimeout(pushTimer);
      pushTimer = window.setTimeout(() => {
        void this.pushCloud();
      }, 2000);
    },
    async pushCloud(force = false) {
      if (!getActivePinia()) return;
      if (!force && !this.reconciled) return;
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn || auth.user?.id !== this.profile) return;
      const profile = this.profile;
      const payload = this.data;
      clearTimeout(pushTimer);
      this.cloud = "syncing";
      try {
        const { updatedAt } = await api.putSave(payload, this.cloudAt || 0);
        // 请求期间切换了账号则丢弃结果，避免把 A 的修订号/状态写到 B。
        if (this.profile !== profile || auth.user?.id !== profile) return;
        this.cloudAt = updatedAt;
        localStorage.setItem(syncedAtKeyFor(profile), String(updatedAt));
        this.cloud = "synced";
      } catch (error) {
        if (this.profile !== profile) return;
        if (error instanceof ApiError && error.status === 409) {
          await this.resolveConflict(error);
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          this.cloud = "idle";
          return;
        }
        this.cloud = "error";
        this.warning = "云端保存失败：" + (error as Error).message;
      }
    },
    /** 服务端拒绝过期写入：合并两端进度后重新上传，绝不覆盖丢档。 */
    async resolveConflict(error: ApiError) {
      const profile = this.profile;
      const conflict = (error.payload as { save?: { updatedAt: number; data: unknown } } | null)?.save;
      if (!conflict) {
        this.cloud = "error";
        this.warning = "云端保存冲突，请稍后重试。";
        return;
      }
      try {
        const remote = validateSave(conflict.data);
        const merged = mergeSave(this.data, remote);
        suppressPush = true;
        try {
          this.data = merged;
          localStorage.setItem(saveKeyFor(profile), JSON.stringify(merged));
        } finally {
          suppressPush = false;
        }
        this.cloudAt = conflict.updatedAt;
        localStorage.setItem(
          syncedAtKeyFor(profile),
          String(conflict.updatedAt),
        );
        const { updatedAt } = await api.putSave(merged, conflict.updatedAt);
        if (this.profile !== profile) return;
        this.cloudAt = updatedAt;
        localStorage.setItem(syncedAtKeyFor(profile), String(updatedAt));
        this.cloud = "synced";
        this.warning = "检测到其他设备的进度，已合并保存。";
      } catch (mergeError) {
        this.cloud = "error";
        this.warning = "云端存档冲突处理失败：" + (mergeError as Error).message;
      }
    },
    /** 显式"下载并覆盖本机"：用户主动选择以云端为准。 */
    async pullCloud() {
      if (!getActivePinia()) return false;
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn || auth.user?.id !== this.profile) return false;
      const profile = this.profile;
      this.cloud = "syncing";
      try {
        const { save: cloudSave } = await api.getSave();
        if (this.profile !== profile) return false;
        this.reconciled = true;
        if (!cloudSave) {
          this.cloud = "synced";
          return false;
        }
        suppressPush = true;
        try {
          this.data = validateSave(cloudSave.data);
          localStorage.setItem(saveKeyFor(profile), JSON.stringify(this.data));
          this.cloudAt = cloudSave.updatedAt;
          localStorage.setItem(
            syncedAtKeyFor(profile),
            String(cloudSave.updatedAt),
          );
        } finally {
          suppressPush = false;
        }
        this.cloud = "synced";
        this.warning = "已用云端存档覆盖本机进度。";
        return true;
      } catch (error) {
        suppressPush = false;
        this.cloud = "error";
        this.warning = "云端读取失败：" + (error as Error).message;
        return false;
      }
    },
    /**
     * 进入某个账号的本机档并对账：
     * - 只读写该账号自己的本机槽，绝不沿用上一个账号 / 访客的内存档；
     * - 云端已有档 → 本账号本机档 ∪ 云档（同一账号多设备仍然合并，不回退）；
     * - 云端为空且账号本机档也为空、但访客档有进度 → 返回 "claim" 询问是否带入（默认不带入）；
     * - 其余情况用账号自己的档初始化云端。
     * 返回 "claim" 时调用方应打开带入确认框。
     */
    async enterProfile(profile: string): Promise<"ok" | "claim"> {
      if (!getActivePinia()) return "ok";
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn || auth.user?.id !== profile) return "ok";
      clearTimeout(pushTimer);
      this.load(profile);
      this.cloud = "syncing";
      try {
        const { save: cloudSave } = await api.getSave();
        if (this.profile !== profile || auth.user?.id !== profile) return "ok";
        if (!cloudSave) {
          // 新账号：默认不带入本机访客进度，先问一次。
          const guest = readProfile(GUEST_PROFILE);
          if (!hasProgress(this.data) && guest && hasProgress(guest)) {
            this.reconciled = true;
            this.cloud = "idle";
            this.claim = { guest: guest };
            return "claim";
          }
          this.reconciled = true;
          await this.pushCloud(true);
          return "ok";
        }
        let remote: Save;
        try {
          remote = validateSave(cloudSave.data);
        } catch {
          this.reconciled = true;
          this.warning = "云端存档无法读取，已用本机进度覆盖。";
          await this.pushCloud(true);
          return "ok";
        }
        const merged = mergeSave(this.data, remote);
        suppressPush = true;
        try {
          this.data = merged;
          localStorage.setItem(saveKeyFor(profile), JSON.stringify(merged));
        } finally {
          suppressPush = false;
        }
        this.cloudAt = cloudSave.updatedAt;
        localStorage.setItem(syncedAtKeyFor(profile), String(cloudSave.updatedAt));
        this.reconciled = true;
        await this.pushCloud(true);
        return "ok";
      } catch (error) {
        suppressPush = false;
        this.reconciled = true;
        this.cloud = "error";
        this.warning = "云端同步失败：" + (error as Error).message;
        return "ok";
      }
    },
    /** 用户对"是否带入本机访客进度"的选择；默认不带入。 */
    async resolveClaim(carry: boolean) {
      const pending = this.claim;
      this.claim = null;
      if (!getActivePinia()) return;
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn || auth.user?.id !== this.profile) return;
      if (carry && pending) {
        const merged = mergeSave(this.data, pending.guest);
        suppressPush = true;
        try {
          this.data = merged;
          localStorage.setItem(saveKeyFor(this.profile), JSON.stringify(merged));
        } finally {
          suppressPush = false;
        }
        this.warning = "已把本机访客进度带入账号。";
      } else {
        this.warning = "已从新账号开始，本机访客进度仍保留。";
      }
      await this.pushCloud(true);
    },
    /** 退出登录：切回访客档，账号档只留在自己的槽与云端，不残留在当前槽。 */
    exitProfile() {
      clearTimeout(pushTimer);
      this.cloud = "idle";
      this.load(GUEST_PROFILE);
      this.reconciled = true;
    },
    win(level: number, coins: number) {
      if (!this.data.completed.includes(level)) this.data.completed.push(level);
      this.data.completed.sort((a, b) => a - b);
      this.data.unlocked = Math.max(
        this.data.unlocked,
        Math.min(51, level + 1),
      );
      // 非有限值会让 coins / coinsEarned 变成 NaN 并触发存档校验失败。
      const gained = Number.isFinite(coins) ? Math.max(0, Math.floor(coins)) : 0;
      this.data.coins += gained;
      this.data.coinsEarned += gained;
      delete this.data.lossStreak[level];
      this.persist();
    },
    /** 自定义模式不解锁冒险进度，但局内收集的金币照常入账。
     *  每日挑战不再调用它：每日挑战是纯挑战，不掉金币、也不进商店。 */
    addCoins(coins: number) {
      if (!Number.isFinite(coins) || coins <= 0) return;
      const gained = Math.floor(coins);
      this.data.coins += gained;
      this.data.coinsEarned += gained;
      this.persist();
    },
    recordLoss(level: number) {
      this.data.lossStreak[level] = (this.data.lossStreak[level] ?? 0) + 1;
      this.persist();
    },
    record(level: number, seconds: number, options: BattleOptions) {
      this.data.scores.push({
        level,
        seconds: Math.round(seconds),
        difficulty: options.difficulty,
        settings:
          options.difficulty === "custom"
            ? JSON.stringify(options)
            : options.difficulty,
      });
      this.data.scores = this.data.scores.slice(-200);
      this.persist();
    },
    recordStars(level: number, n: number) {
      this.data.stars[level] = Math.max(
        this.data.stars[level] ?? 0,
        Math.round(n),
      );
      this.persist();
    },
    recordDaily(date: string, seconds: number) {
      if (this.data.daily.date !== date || seconds < this.data.daily.best)
        this.data.daily = { date, best: Math.round(seconds) };
      this.persist();
    },
    buyItem(id: string, price: number) {
      if (this.data.coins < price) return false;
      this.data.coins -= price;
      this.data.coinsSpent += price;
      this.data.items[id] = (this.data.items[id] ?? 0) + 1;
      // 累计获得只增不减：云合并靠它区分「没赚到」和「已经花掉」。
      this.data.itemsEarned[id] = (this.data.itemsEarned[id] ?? 0) + 1;
      this.persist();
      return true;
    },
    /** 购买基础卡槽扩容（消耗金币，coinsEarned 不变、coinsSpent 增加）。 */
    buySeedSlot(price: number) {
      if (this.data.coins < price) return false;
      if (this.data.seedSlots >= MAX_SEED_SLOT_PURCHASES) return false;
      this.data.coins -= price;
      this.data.coinsSpent += price;
      this.data.seedSlots += 1;
      this.persist();
      return true;
    },
    /**
     * 开局消耗道具。逐项扣减并记入 itemsSpent，返回实际生效的项，
     * 供调用方决定是否给引擎加成（避免 UI 层直接改 items 而绕过记账，
     * 那样云合并会把用掉的道具复活）。
     */
    consumeItems(ids: string[]) {
      const used: string[] = [];
      for (const id of ids) {
        if ((this.data.items[id] ?? 0) <= 0) continue;
        this.data.items[id] -= 1;
        this.data.itemsSpent[id] = (this.data.itemsSpent[id] ?? 0) + 1;
        used.push(id);
      }
      if (used.length) this.persist();
      return used;
    },
    importSave(raw: string) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw Error("存档文件不是合法 JSON");
      }
      this.data = validateSave(parsed);
      // 导入是用户显式要求的覆盖，不能与槽内旧档合并。
      this.persist(true);
      this.warning = "存档已导入。";
    },
  },
});
