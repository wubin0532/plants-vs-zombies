import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { initial, mergeSave, validateSave, useSave, type Save } from "../src/store";

const make = (over: Partial<Save>): Save =>
  validateSave({ ...initial(), ...over });

describe("云存档合并（进度并集，绝不回退）", () => {
  it("取更长的连续进度，unlocked 与之一致", () => {
    const local = make({ completed: [1, 2, 3], unlocked: 4 });
    const cloud = make({ completed: [1, 2, 3, 4, 5], unlocked: 6 });
    const merged = mergeSave(local, cloud);
    expect(merged.completed).toEqual([1, 2, 3, 4, 5]);
    expect(merged.unlocked).toBe(6);
    // 交换顺序结果一致：合并是对称的
    expect(mergeSave(cloud, local).completed).toEqual([1, 2, 3, 4, 5]);
  });

  it("金币取两侧较高的余额，击杀/卡槽取最大，成就与教学标记取并集，星级取每关最大", () => {
    const local = make({
      coins: 1200,
      kills: 40,
      seedSlots: 1,
      achievements: ["first-win"],
      tutorialSeen: ["a"],
      stars: { 1: 3, 2: 1 },
      items: { "sun-boost": 2, "spare-mower": 1 },
    });
    const cloud = make({
      coins: 800,
      kills: 99,
      seedSlots: 3,
      achievements: ["killer-100"],
      tutorialSeen: ["b"],
      stars: { 2: 2, 3: 1 },
      items: { "sun-boost": 1, "spare-mower": 4 },
    });
    const merged = mergeSave(local, cloud);
    expect(merged.coins).toBe(1200);
    expect(merged.kills).toBe(99);
    expect(merged.seedSlots).toBe(3);
    expect(merged.achievements.sort()).toEqual(["first-win", "killer-100"]);
    expect(merged.tutorialSeen.sort()).toEqual(["a", "b"]);
    expect(merged.stars).toMatchObject({ 1: 3, 2: 2, 3: 1 });
    expect(merged.items).toMatchObject({ "sun-boost": 2, "spare-mower": 4 });
  });

  it("已花掉的金币与已用掉的道具不会被旧快照复活", () => {
    // 设备 A（新档，带记账）：累计赚 1000，花掉 300 → 余额 700；
    // 买过 2 个应急阳光并已用掉 → 余额 0、累计消耗 2。
    const fresh = make({
      completed: [1, 2, 3, 4, 5],
      unlocked: 6,
      coins: 700,
      coinsEarned: 1000,
      coinsSpent: 300,
      items: {},
      itemsEarned: { "sun-boost": 2 },
      itemsSpent: { "sun-boost": 2 },
    });
    // 设备 B：还停在消费之前的旧快照（coins 900、items 2），进度也更旧。
    const stale = make({
      completed: [1, 2, 3],
      unlocked: 4,
      coins: 900,
      coinsEarned: 900,
      coinsSpent: 0,
      items: { "sun-boost": 2 },
      itemsEarned: { "sun-boost": 2 },
      itemsSpent: {},
    });
    const merged = mergeSave(stale, fresh);
    // 旧行为 max(900,700)=900 / max(2,0)=2 —— 消费被凭空还原。
    expect(merged.coins).toBe(700);
    expect(merged.items["sun-boost"] ?? 0).toBe(0);
    expect(merged.coinsEarned).toBe(1000);
    expect(merged.coinsSpent).toBe(300);
    expect(merged.itemsEarned["sun-boost"]).toBe(2);
    expect(merged.itemsSpent["sun-boost"]).toBe(2);
    // 余额不可能超过累计获得。
    expect(merged.coins).toBeLessThanOrEqual(merged.coinsEarned);
    // 进度仍是并集，不因资源修正而回退。
    expect(merged.completed).toEqual([1, 2, 3, 4, 5]);
    expect(merged.unlocked).toBe(6);
  });

  it("同一批消费被两端各记一次时不重复计价", () => {
    const one = make({ coins: 700, coinsEarned: 1000, coinsSpent: 300, items: { "sun-boost": 0 }, itemsEarned: { "sun-boost": 2 }, itemsSpent: { "sun-boost": 2 } });
    const two = make({ coins: 700, coinsEarned: 1000, coinsSpent: 300, items: {}, itemsEarned: { "sun-boost": 2 }, itemsSpent: { "sun-boost": 2 } });
    const merged = mergeSave(one, two);
    expect(merged.coins).toBe(700);
    expect(merged.items["sun-boost"] ?? 0).toBe(0);
  });

  it("合并结果不膨胀，与自身合并不误扣", () => {
    const a = make({ coins: 700, coinsEarned: 1000, coinsSpent: 300, items: { "spare-mower": 1 }, itemsEarned: { "spare-mower": 3 }, itemsSpent: { "spare-mower": 2 } });
    const b = make({ coins: 400, coinsEarned: 400, coinsSpent: 0, items: { "spare-mower": 3 }, itemsEarned: { "spare-mower": 3 }, itemsSpent: {} });
    const merged = mergeSave(a, b);
    // 绝不膨胀：不超过双方的累计获得，也不超过任一方的余额超过获得的那种脏数据。
    expect(merged.coins).toBeLessThanOrEqual(merged.coinsEarned);
    expect(merged.items["spare-mower"]).toBeLessThanOrEqual(3);
    // 与自身合并（persist 的读-合并-写会走到这条路径）必须恒等，不能误扣一次消费。
    const self = mergeSave(
      a,
      make({
        coins: a.coins,
        coinsEarned: a.coinsEarned,
        coinsSpent: a.coinsSpent,
        items: { ...a.items },
        itemsEarned: { ...a.itemsEarned },
        itemsSpent: { ...a.itemsSpent },
      }),
    );
    expect(self.coins).toBe(700);
    expect(self.items["spare-mower"]).toBe(1);
  });

  it("没有记账字段的旧档回退为按余额取最大", () => {
    // 读到旧档（v1 / 旧 v2）时把余额当作累计获得，账目自此自洽。
    const legacy = make({ coins: 900, items: { "sun-boost": 2 } });
    expect(legacy.coinsEarned).toBe(900);
    expect(legacy.coinsSpent).toBe(0);
    expect(legacy.itemsEarned["sun-boost"]).toBe(2);
    expect(legacy.itemsSpent["sun-boost"] ?? 0).toBe(0);
    // 两侧都没有记账能力时（绕过 validateSave 构造）退化为旧的 max(余额)。
    const bareA = { ...legacy, coins: 900, coinsEarned: 0, itemsEarned: {}, itemsSpent: {} };
    const bareB = { ...legacy, coins: 700, items: { "sun-boost": 1 }, coinsEarned: 0, itemsEarned: {}, itemsSpent: {} };
    expect(mergeSave(bareA, bareB).coins).toBe(900);
    expect(mergeSave(bareA, bareB).items["sun-boost"]).toBe(2);
  });
  it("空存档与有进度存档合并不丢进度", () => {
    const empty = make({});
    const rich = make({ completed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], unlocked: 11 });
    expect(progressOf(mergeSave(empty, rich))).toBe(progressOf(rich));
    expect(progressOf(mergeSave(rich, empty))).toBe(progressOf(rich));
  });
});

function progressOf(s: Save) {
  return s.completed.length * 1000 + s.unlocked;
}

describe("存档校验与导入", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("拒绝不连续进度、非法数值与未知版本", () => {
    expect(() => validateSave({ ...initial(), completed: [1, 3], unlocked: 3 })).toThrow();
    expect(() => validateSave({ ...initial(), version: 3 })).toThrow();
    expect(() => validateSave({ ...initial(), coins: -1 })).toThrow();
  });

  it("importSave 对非法 JSON 抛错且不覆盖当前进度", () => {
    const save = useSave();
    save.data = make({ completed: [1, 2, 3], unlocked: 4 });
    expect(() => save.importSave("{ not json")).toThrow();
    expect(save.data.completed).toEqual([1, 2, 3]);
    // 合法导入生效
    save.importSave(JSON.stringify({ ...initial(), completed: [1, 2], unlocked: 3 }));
    expect(save.data.completed).toEqual([1, 2]);
  });
});
