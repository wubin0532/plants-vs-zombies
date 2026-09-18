import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { applyDailyMods, dailyChallenge, dailyPlayable } from "../src/game/daily";
import { levels, plantById } from "../src/game/content";

const days = (n: number, start = new Date(2026, 0, 1)) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });

describe("每日挑战智能生成", () => {
  it("同一天生成结果完全确定", () => {
    for (const date of [
      new Date(2026, 8, 14),
      new Date(2026, 0, 1),
      new Date(2027, 11, 31),
    ])
      expect(dailyChallenge(date, 50)).toEqual(dailyChallenge(date, 50));
  });

  it("同一天用不同盐可以重抽到不同挑战，且不影响官方种子", () => {
    const date = new Date(2026, 8, 18);
    const official = dailyChallenge(date, 50);
    const seen = new Set([official.levelId + ":" + official.cards.join(",")]);
    for (let salt = 1; salt <= 12; salt++) {
      const c = dailyChallenge(date, 50, salt);
      expect(c.date).toBe(official.date);
      expect(c.seed).not.toBe(official.seed);
      expect(dailyPlayable(levels[c.levelId - 1], c.cards)).toBe(true);
      seen.add(c.levelId + ":" + c.cards.join(","));
    }
    expect(seen.size).toBeGreaterThan(3);
    // 官方种子始终固定。
    expect(dailyChallenge(date, 50)).toEqual(official);
  });

  it("低进度新存档也有真实关卡变化，且每关都可打", () => {
    // 旧实现取 1..unlocked：unlocked=1 时 60 天只有第 1 关。
    for (const unlocked of [1, 10, 25, 50]) {
      const rows = days(500).map((d) => dailyChallenge(d, unlocked));
      const seen = new Set(rows.map((r) => r.levelId));
      expect(seen.size, `解锁 ${unlocked} 的关卡覆盖度`).toBeGreaterThanOrEqual(6);
      expect(new Set(rows.map((r) => r.seed)).size).toBe(rows.length);
      expect(
        new Set(rows.map((r) => r.cards.join(","))).size,
        `解锁 ${unlocked} 的卡池丰富度`,
      ).toBeGreaterThan(50);
      for (const c of rows) {
        const level = levels[c.levelId - 1];
        expect(level.mode, `${c.date} 抽到非普通关`).toBe("normal");
        expect(dailyPlayable(level, c.cards), `${c.date} 第 ${level.id} 关`).toBe(
          true,
        );
      }
    }
  });

  it("卡池按关卡时代裁剪，早期关不会给后期植物", () => {
    let first: ReturnType<typeof dailyChallenge> | undefined;
    for (const d of days(60))
      if (dailyChallenge(d, 1).levelId === 1) {
        first = dailyChallenge(d, 1);
        break;
      }
    expect(first).toBeTruthy();
    // eraCap(第 1 关) = 6，只允许同期植物。
    for (const id of first!.cards)
      expect(plantById[id].unlock, `${id} 超出第 1 关时代`).toBeLessThanOrEqual(6);
    expect(first!.cards.length).toBeLessThanOrEqual(6);
  });

  it("全年 × 各解锁进度的卡池都可打", () => {
    for (let month = 0; month < 12; month++)
      for (let day = 1; day <= 28; day++)
        for (const unlocked of [1, 10, 25, 50]) {
          const c = dailyChallenge(new Date(2026, month, day), unlocked);
          const level = levels[c.levelId - 1];
          const tag = `${c.date} / 解锁 ${unlocked}`;
          const cap = Math.min(50, Math.max(10, unlocked));
          expect(c.levelId, tag).toBeGreaterThanOrEqual(1);
          expect(c.levelId, tag).toBeLessThanOrEqual(cap);
          expect(c.cards.length, tag).toBeGreaterThanOrEqual(4);
          expect(c.cards.length, tag).toBeLessThanOrEqual(8);
          expect(new Set(c.cards).size, tag).toBe(c.cards.length);
          expect(c.cards.every((id) => !plantById[id].upgrade), tag).toBe(true);
          expect(c.cards, tag).not.toContain("imitater");
          expect(["sunflower", "sunshroom"], tag).toContain(c.cards[0]);
          expect(dailyPlayable(level, c.cards), `${tag} 卡池不可打`).toBe(true);
        }
  });

  it("机制僵尸的克制由种子决定，但每天都有解", () => {
    const answers = new Set<string>();
    const antiAir = ["cactus", "blover"];
    for (const date of days(240)) {
      const c = dailyChallenge(date, 50);
      const level = levels[c.levelId - 1];
      if (!level.enemies.includes("balloon")) continue;
      const answer = c.cards.find((id) => antiAir.includes(id));
      expect(answer, `${c.date} 气球关卡池缺防空`).toBeTruthy();
      answers.add(answer!);
    }
    expect(answers.size).toBe(2);
  });
});

describe("每日词缀", () => {
  it("同一天词缀固定，数量与互斥规则都成立", () => {
    for (const date of days(150))
      for (const unlocked of [1, 50]) {
        const a = dailyChallenge(date, unlocked);
        expect(a.mods).toEqual(dailyChallenge(date, unlocked).mods);
        const ids = a.mods.map((m) => m.id);
        for (const mod of a.mods) {
          expect(["bane", "boon", "twist"]).toContain(mod.tone);
          expect(mod.name.length, mod.id).toBeGreaterThan(0);
          expect(mod.desc.length, mod.id).toBeGreaterThan(0);
        }
        const count = (tone: string) => a.mods.filter((m) => m.tone === tone).length;
        expect(count("bane"), a.date).toBeGreaterThanOrEqual(1);
        expect(count("bane"), a.date).toBeLessThanOrEqual(2);
        expect(count("boon"), a.date).toBeLessThanOrEqual(1);
        expect(count("twist"), a.date).toBeLessThanOrEqual(1);
        expect(ids.includes("thin-deck") && ids.includes("wide-deck")).toBe(false);
        expect(ids.includes("low-sun") && ids.includes("rich-sun")).toBe(false);
      }
  });

  it("残缺防线至少保留 2 行割草机", () => {
    let checked = 0;
    for (const date of days(300)) {
      const d = dailyChallenge(date, 50);
      if (!d.mods.some((m) => m.id === "mower-loss")) continue;
      const e = new Engine(d.levelId, d.cards, d.seed, d.options);
      applyDailyMods(e, d.mods);
      expect(e.mowers.filter(Boolean).length, d.date).toBeGreaterThanOrEqual(2);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("阳光 / 卡组 / 阴云 / 天气 / 单一尸群都真的生效", () => {
    const seen = new Set<string>();
    for (const date of days(500)) {
      const d = dailyChallenge(date, 50);
      const e = new Engine(d.levelId, d.cards, d.seed, d.options);
      applyDailyMods(e, d.mods);
      // 每日挑战纯挑战：不掉金币、不出黄金僵尸、不发万寿菊。
      expect(e.coinDrops, d.date).toBe(false);
      expect(e.goldenChance, d.date).toBe(0);
      expect(d.cards, d.date).not.toContain("marigold");
      for (const mod of d.mods) seen.add(mod.id);
      const low = d.mods.find((m) => m.id === "low-sun");
      if (low) expect(e.sun, d.date).toBe(low.value);
      const rich = d.mods.find((m) => m.id === "rich-sun");
      if (rich) expect(e.sun, d.date).toBe(150 + rich.value);
      const sky = d.mods.find((m) => m.id === "sparse-sky-sun");
      if (sky) expect(e.skySunInterval, d.date).toBe(sky.value);
      const weather = d.mods.find((m) => m.id === "always-weather");
      if (weather) {
        expect(e.weatherLoop, d.date).toBe(true);
        expect(e.eventKind).toBe(weather.weather);
      }
      const mono = d.mods.find((m) => m.id === "mono-zombies");
      if (mono) {
        expect(e.level.enemies, d.date).toEqual(mono.enemies);
        // 引擎用的是副本，不能污染全局关卡数据。
        expect(levels[d.levelId - 1].enemies.length).toBeGreaterThanOrEqual(
          mono.enemies!.length,
        );
      }
      const thin = d.mods.find((m) => m.id === "thin-deck");
      if (thin) expect(d.cards.length, d.date).toBeLessThanOrEqual(7);
      expect(d.cards.length, d.date).toBeGreaterThanOrEqual(4);
      expect(d.cards.length, d.date).toBeLessThanOrEqual(8);
    }
    // 词缀池应全部被覆盖到。
    for (const id of [
      "mower-loss", "low-sun", "sparse-sky-sun", "dense-waves",
      "tough-zombies", "thin-deck", "rich-sun", "spare-mower",
      "wide-deck", "mono-zombies", "always-weather",
    ])
      expect(seen.has(id), id).toBe(true);
  });

  it("重抽会同时换关卡与词缀", () => {
    const date = new Date(2026, 8, 18);
    const official = dailyChallenge(date, 50);
    let modDiff = 0;
    for (let salt = 1; salt <= 20; salt++)
      if (
        JSON.stringify(dailyChallenge(date, 50, salt).mods) !==
        JSON.stringify(official.mods)
      )
        modDiff++;
    expect(modDiff).toBeGreaterThan(10);
    expect(dailyChallenge(date, 50).mods).toEqual(official.mods);
  });
});
