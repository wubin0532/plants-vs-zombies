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
    persist() {
      try {
        localStorage.setItem(saveKeyFor(this.profile), JSON.stringify(this.data));
      } catch {
        this.warning = "浏览器未能保存进度，请导出存档备份。";
      }
      this.scheduleCloudPush();
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
