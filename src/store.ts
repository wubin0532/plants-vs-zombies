import {
  defaultOptions,
  normalizeOptions,
  type BattleOptions,
} from "./game/difficulty";
import { defineStore } from "pinia";
export type Save = {
  version: 1;
  unlocked: number;
  completed: number[];
  coins: number;
  sound: boolean;
  volume: number;
  quality: "low" | "medium" | "high";
  shake: boolean;
  options: BattleOptions;
  scores: {
    level: number;
    difficulty: string;
    seconds: number;
    settings: string;
  }[];
};
export const initial = (): Save => ({
  version: 1,
  unlocked: 1,
  completed: [],
  coins: 0,
  sound: true,
  volume: 0.65,
  quality: "high",
  shake: true,
  options: defaultOptions(),
  scores: [],
});
export function validateSave(data: unknown): Save {
  const d = data as Save;
  if (
    !d ||
    d.version !== 1 ||
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
  return {
    ...d,
    completed: complete,
    volume:
      typeof d.volume === "number" && Number.isFinite(d.volume)
        ? Math.max(0, Math.min(1, d.volume))
        : 0.65,
    quality: ["low", "medium", "high"].includes(d.quality) ? d.quality : "high",
    shake: typeof d.shake === "boolean" ? d.shake : true,
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
export const useSave = defineStore("save", {
  state: () => ({ data: initial(), warning: "" }),
  actions: {
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (raw) this.data = validateSave(JSON.parse(raw));
      } catch {
        this.warning = "本地存档无法读取。可导入备份恢复，原数据尚未覆盖。";
      }
    },
    persist() {
      try {
        localStorage.setItem(key, JSON.stringify(this.data));
      } catch {
        this.warning = "浏览器未能保存进度，请导出存档备份。";
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
    importSave(raw: string) {
      this.data = validateSave(JSON.parse(raw));
      this.persist();
      this.warning = "存档已导入。";
    },
  },
});
