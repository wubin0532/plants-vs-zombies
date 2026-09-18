import {
  defaultOptions,
  normalizeOptions,
  type BattleOptions,
} from "./game/difficulty";
import { defineStore, getActivePinia } from "pinia";
import { useAuth } from "./auth";
import { ApiError, api } from "./api";
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
  seedSlots: 0,
  kills: 0,
  contrast: false,
  fontSize: "standard",
  options: defaultOptions(),
  scores: [],
});
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
    items:
      d.items && typeof d.items === "object"
        ? Object.fromEntries(
            Object.entries(d.items).filter(
              ([id, n]) =>
                id !== "ice-start" && Number.isInteger(n) && n > 0 && n <= 99,
            ),
          )
        : {},
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
  const items: Record<string, number> = { ...a.items };
  for (const [id, n] of Object.entries(b.items ?? {}))
    items[id] = Math.max(items[id] ?? 0, n);
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
    coins: Math.max(a.coins, b.coins),
    kills: Math.max(a.kills, b.kills),
    seedSlots: Math.max(a.seedSlots, b.seedSlots),
    stars,
    items,
    achievements: [...new Set([...a.achievements, ...b.achievements])],
    tutorialSeen: [...new Set([...a.tutorialSeen, ...b.tutorialSeen])].slice(0, 30),
    scores: [...a.scores, ...b.scores].slice(-200),
    daily: Number.isFinite(daily.best) ? daily : { date: daily.date, best: 0 },
  };
  return validateSave(merged);
}

const key = "pvz-garden-save-v1";
const syncedAtKey = "pvz-garden-save-synced-at";
let pushTimer: number | undefined;
let suppressPush = false;
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
export const useSave = defineStore("save", {
  state: () => ({
    data: initial(),
    warning: "",
    cloud: "idle" as CloudState,
    /** 本机已见到的服务端修订号（乐观并发的 base），持久化以跨刷新保留。 */
    cloudAt: 0,
    /** 是否已完成登录/恢复后的首次对账；未完成前禁止云推送。 */
    reconciled: false,
  }),
  actions: {
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (raw) this.data = validateSave(JSON.parse(raw));
      } catch {
        this.warning =
          "本地存档损坏，进度已重置。如有备份，可在设置中导入恢复。";
      }
      try {
        const synced = Number(localStorage.getItem(syncedAtKey) ?? 0) || 0;
        this.cloudAt = Number.isFinite(synced) ? synced : 0;
      } catch {
        this.cloudAt = 0;
      }
    },
    persist() {
      try {
        localStorage.setItem(key, JSON.stringify(this.data));
      } catch {
        this.warning = "浏览器未能保存进度，请导出存档备份。";
      }
      this.scheduleCloudPush();
    },
    scheduleCloudPush() {
      if (!getActivePinia() || suppressPush) return;
      if (!this.reconciled) return;
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn) return;
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
      if (!auth.loggedIn) return;
      clearTimeout(pushTimer);
      this.cloud = "syncing";
      try {
        const { updatedAt } = await api.putSave(this.data, this.cloudAt || 0);
        this.cloudAt = updatedAt;
        localStorage.setItem(syncedAtKey, String(updatedAt));
        this.cloud = "synced";
      } catch (error) {
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
          localStorage.setItem(key, JSON.stringify(merged));
        } finally {
          suppressPush = false;
        }
        this.cloudAt = conflict.updatedAt;
        localStorage.setItem(syncedAtKey, String(conflict.updatedAt));
        const { updatedAt } = await api.putSave(this.data, conflict.updatedAt);
        this.cloudAt = updatedAt;
        localStorage.setItem(syncedAtKey, String(updatedAt));
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
      if (!auth.loggedIn) return false;
      this.cloud = "syncing";
      try {
        const { save: cloudSave } = await api.getSave();
        this.reconciled = true;
        if (!cloudSave) {
          this.cloud = "synced";
          return false;
        }
        suppressPush = true;
        try {
          this.data = validateSave(cloudSave.data);
          localStorage.setItem(key, JSON.stringify(this.data));
          this.cloudAt = cloudSave.updatedAt;
          localStorage.setItem(syncedAtKey, String(cloudSave.updatedAt));
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
     * 登录 / 会话恢复后的对账入口：先取云端，合并两端进度，再上传合并结果。
     * 使用服务端修订号而非客户端时钟；在完成前 pushCloud 被 reconciled 拦截。
     */
    async reconcile() {
      if (!getActivePinia()) return;
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn) {
        this.reconciled = true;
        return;
      }
      this.cloud = "syncing";
      try {
        const { save: cloudSave } = await api.getSave();
        if (!cloudSave) {
          this.reconciled = true;
          await this.pushCloud(true);
          return;
        }
        let remote: Save;
        try {
          remote = validateSave(cloudSave.data);
        } catch {
          this.reconciled = true;
          this.warning = "云端存档无法读取，已用本机进度覆盖。";
          await this.pushCloud(true);
          return;
        }
        const merged = mergeSave(this.data, remote);
        suppressPush = true;
        try {
          this.data = merged;
          localStorage.setItem(key, JSON.stringify(merged));
        } finally {
          suppressPush = false;
        }
        this.cloudAt = cloudSave.updatedAt;
        localStorage.setItem(syncedAtKey, String(cloudSave.updatedAt));
        this.reconciled = true;
        await this.pushCloud(true);
      } catch (error) {
        suppressPush = false;
        this.reconciled = true;
        this.cloud = "error";
        this.warning = "云端同步失败：" + (error as Error).message;
      }
    },
    win(level: number, coins: number) {
      if (!this.data.completed.includes(level)) this.data.completed.push(level);
      this.data.completed.sort((a, b) => a - b);
      this.data.unlocked = Math.max(
        this.data.unlocked,
        Math.min(51, level + 1),
      );
      this.data.coins += coins;
      delete this.data.lossStreak[level];
      this.persist();
    },
    /** 自定义模式不解锁冒险进度，但局内收集的金币照常入账。
     *  每日挑战不再调用它：每日挑战是纯挑战，不掉金币、也不进商店。 */
    addCoins(coins: number) {
      if (!Number.isFinite(coins) || coins <= 0) return;
      this.data.coins += Math.floor(coins);
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
      this.data.items[id] = (this.data.items[id] ?? 0) + 1;
      this.persist();
      return true;
    },
    importSave(raw: string) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw Error("存档文件不是合法 JSON");
      }
      this.data = validateSave(parsed);
      this.persist();
      this.warning = "存档已导入。";
    },
  },
});
