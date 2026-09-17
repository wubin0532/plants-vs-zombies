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
const key = "pvz-garden-save-v1";
const localAtKey = "pvz-garden-save-local-at";
let pushTimer: number | undefined;
let suppressPush = false;
export const seedSlotPriceFor = (seedSlots: number) =>
  seedSlots === 0 ? 1500 : seedSlots < 4 ? 2500 : 5000;
export const useSave = defineStore("save", {
  state: () => ({
    data: initial(),
    warning: "",
    cloud: "idle" as CloudState,
    cloudAt: 0,
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
    },
    persist() {
      try {
        localStorage.setItem(key, JSON.stringify(this.data));
        localStorage.setItem(localAtKey, String(Date.now()));
      } catch {
        this.warning = "浏览器未能保存进度，请导出存档备份。";
      }
      this.scheduleCloudPush();
    },
    scheduleCloudPush() {
      if (!getActivePinia() || suppressPush) return;
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn) return;
      if (typeof window === "undefined") return;
      clearTimeout(pushTimer);
      pushTimer = window.setTimeout(() => {
        void this.pushCloud();
      }, 2000);
    },
    async pushCloud() {
      if (!getActivePinia()) return;
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn) return;
      clearTimeout(pushTimer);
      this.cloud = "syncing";
      try {
        const { updatedAt } = await api.putSave(this.data);
        this.cloudAt = updatedAt;
        this.cloud = "synced";
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          auth.user = null;
          this.cloud = "idle";
          return;
        }
        this.cloud = "error";
        this.warning = "云端保存失败：" + (error as Error).message;
      }
    },
    async pullCloud() {
      if (!getActivePinia()) return false;
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn) return false;
      this.cloud = "syncing";
      try {
        const { save: cloudSave } = await api.getSave();
        if (!cloudSave) {
          this.cloud = "synced";
          return false;
        }
        suppressPush = true;
        try {
          this.data = validateSave(cloudSave.data);
          localStorage.setItem(key, JSON.stringify(this.data));
          localStorage.setItem(localAtKey, String(Date.now()));
          this.cloudAt = cloudSave.updatedAt;
        } finally {
          suppressPush = false;
        }
        this.cloud = "synced";
        return true;
      } catch (error) {
        suppressPush = false;
        this.cloud = "error";
        this.warning = "云端读取失败：" + (error as Error).message;
        return false;
      }
    },
    async syncOnLogin() {
      if (!getActivePinia()) return;
      const auth = useAuth(getActivePinia()!);
      if (!auth.loggedIn) return;
      this.cloud = "syncing";
      try {
        const { save: cloudSave } = await api.getSave();
        const localAt = Number(localStorage.getItem(localAtKey) ?? 0) || 0;
        if (!cloudSave) {
          await this.pushCloud();
          return;
        }
        if (cloudSave.updatedAt > localAt) {
          suppressPush = true;
          try {
            this.data = validateSave(cloudSave.data);
            localStorage.setItem(key, JSON.stringify(this.data));
            localStorage.setItem(localAtKey, String(Date.now()));
            this.cloudAt = cloudSave.updatedAt;
          } finally {
            suppressPush = false;
          }
          this.cloud = "synced";
        } else {
          await this.pushCloud();
        }
      } catch (error) {
        suppressPush = false;
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
    /** 每日挑战与自定义模式不解锁冒险进度，但局内收集的金币照常入账。 */
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
      this.data = validateSave(JSON.parse(raw));
      this.persist();
      this.warning = "存档已导入。";
    },
  },
});
