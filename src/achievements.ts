import type { Save } from "./store";
export type BattleResult = {
  coins: number;
  difficulty: string;
  mowersIntact: boolean;
};
export const achievementDefs: {
  id: string;
  name: string;
  desc: string;
  check: (save: Save, result?: BattleResult) => boolean;
}[] = [
  {
    id: "first-win",
    name: "初战告捷",
    desc: "赢得第一场战斗胜利",
    check: (s) => s.completed.length > 0,
  },
  {
    id: "killer-100",
    name: "百斩园丁",
    desc: "累计击败 100 只僵尸",
    check: (s) => s.kills >= 100,
  },
  {
    id: "star-3",
    name: "完美防线",
    desc: "在任意关卡获得三星评价",
    check: (s) => Object.values(s.stars).some((n) => n >= 3),
  },
  {
    id: "coin-1000",
    name: "金币收藏家",
    desc: "一局之内收集 1000 金币",
    check: (_s, r) => !!r && r.coins >= 1000,
  },
  {
    id: "world-clear",
    name: "一方守护者",
    desc: "通关任意一个世界的全部关卡",
    check: (s) =>
      [0, 10, 20, 30, 40].some((start) =>
        Array.from({ length: 10 }, (_, i) => start + i + 1).every((id) =>
          s.completed.includes(id),
        ),
      ),
  },
  {
    id: "all-clear",
    name: "庭院大师",
    desc: "通关全部 50 个关卡",
    check: (s) => s.completed.length >= 50,
  },
  {
    id: "hard-win",
    name: "硬核园丁",
    desc: "在困难难度下赢得一关",
    check: (_s, r) => r?.difficulty === "hard",
  },
  {
    id: "no-mower",
    name: "分毫不失",
    desc: "不触发任何小推车赢得一关",
    check: (_s, r) => !!r?.mowersIntact,
  },
];
export function checkAchievements(save: Save, result?: BattleResult) {
  return achievementDefs.filter(
    (a) => !save.achievements.includes(a.id) && a.check(save, result),
  );
}
