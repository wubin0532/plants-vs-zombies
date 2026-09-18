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

  it("金币/击杀/卡槽取最大，成就与教学标记取并集，星级取每关最大", () => {
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
