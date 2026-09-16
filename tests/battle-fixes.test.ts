import { it, expect, describe } from "vitest";
import { Engine } from "../src/game/engine";
import { dailyChallenge } from "../src/game/daily";
import { levels } from "../src/game/content";

/** 夜间关卡，蘑菇保持清醒。 */
const night = () => new Engine(11, []);
/** 白天泳池关卡（21 起为泳池场景，2/3 行是水路）。 */
const pool = () => new Engine(21, []);

function step(e: Engine, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) e.step(0.1);
}

describe("玉米炮两格配对", () => {
  function cannon(e: Engine, row: number, col: number) {
    e.sun = 10000;
    e.cooldowns = {}; // 测试里连续摆炮，跳过卡片冷却
    e.addPlant("kernel", row, col);
    e.addPlant("kernel", row, col + 1);
    expect(e.plant("cob", row, col)).toBe(true);
    return e.plants.filter((p) => p.id === "cob" && p.row === row);
  }

  it("铲掉任何一半，两半一起移除", () => {
    const e = night();
    cannon(e, 0, 3);
    expect(e.plants.filter((p) => p.id === "cob")).toHaveLength(2);
    e.shovel(0, 4); // 铲右半边
    expect(e.plants.filter((p) => p.id === "cob")).toHaveLength(0);
  });

  it("一半被摧毁，另一半不留下无法发射的残格", () => {
    const e = night();
    cannon(e, 0, 3);
    const right = e.plants.find((p) => p.id === "cob" && p.col === 4)!;
    e.remove(right, true);
    expect(e.plants.filter((p) => p.id === "cob")).toHaveLength(0);
    expect(e.plantsLost).toBe(2);
  });

  it("一半被僵尸吃掉，另一半同样一起消失", () => {
    const e = night();
    cannon(e, 0, 3);
    e.plants.find((p) => p.id === "cob" && p.col === 3)!.hp = 0;
    e.step(0.1);
    expect(e.plants.filter((p) => p.id === "cob")).toHaveLength(0);
  });

  it("两门炮紧挨着时，铲第二门炮的左半边不会误删第一门炮的右半边", () => {
    const e = night();
    cannon(e, 0, 2); // 占 2、3 列
    cannon(e, 0, 4); // 占 4、5 列
    expect(e.plants.filter((p) => p.id === "cob")).toHaveLength(4);
    e.shovel(0, 4); // 第二门炮的左半边
    const rest = e.plants.filter((p) => p.id === "cob").map((p) => p.col);
    expect(rest.sort()).toEqual([2, 3]);
  });
});

describe("磁力菇与地下矿工", () => {
  it("能吸走地下矿工的矿镐并把它拉出地面", () => {
    const e = night();
    const m = e.addPlant("magnet", 0, 3);
    m.timer = 0;
    e.spawn("digger", 0, 4.5);
    const z = e.zombies[0];
    z.underground = true;
    e.step(0.1);
    expect(z.disarmed).toBe(true);
    expect(z.underground).toBe(false);
  });
});

describe("潜水僵尸与直射弹丸", () => {
  it("普通豌豆越过潜水僵尸命中后方目标", () => {
    const e = new Engine(21, []);
    e.addPlant("pea", 2, 1).timer = 0;
    e.spawn("snorkel", 2, 5);
    e.spawn("bucket", 2, 7);
    const [snorkel, bucket] = e.zombies;
    step(e, 3);
    expect(snorkel.hp, "潜水僵尸不该挡住直射豌豆").toBe(snorkel.max);
    expect(bucket.armor + bucket.hp, "后方目标应该被打到").toBeLessThan(
      bucket.maxArmor + bucket.max,
    );
  });

  it("投手的抛物线仍能直接打中潜水僵尸", () => {
    const e = new Engine(21, []);
    e.addPlant("cabbage", 2, 1).timer = 0;
    e.spawn("snorkel", 2, 6);
    const z = e.zombies[0];
    step(e, 4);
    expect(z.hp).toBeLessThan(z.max);
  });
});

describe("裂荚射手前后兼顾", () => {
  it("前方和后方都有目标时两个方向都会开火", () => {
    const e = new Engine(1, []);
    e.addPlant("split", 0, 4).timer = 0;
    e.spawn("basic", 0, 7);
    e.spawn("basic", 0, 1.5);
    const [front, back] = e.zombies;
    step(e, 2);
    expect(front.hp).toBeLessThan(front.max);
    expect(back.hp).toBeLessThan(back.max);
  });
});

describe("吸金磁不漏金币", () => {
  it("金币快消失时立刻收取，不等 24 秒固定间隔", () => {
    const e = night();
    const g = e.addPlant("goldmagnet", 0, 3);
    g.timer = 24; // 距离下一次固定收集还很远
    e.token(4, 0, 10, true);
    e.tokens[0].age = 14; // 金币 16 秒就会消失
    const before = e.coins;
    e.step(0.1);
    expect(e.coins).toBe(before + 10);
    expect(e.tokens).toHaveLength(0);
  });
});

describe("雪橇与冰道", () => {
  it("在冰道上快速推进，离开冰道失去速度", () => {
    const onIce = pool();
    for (let c = 0; c < 9; c++)
      onIce.tiles.push({ row: 0, col: c, type: "ice", life: 60 });
    onIce.spawn("bobsled", 0, 8);
    const offIce = pool();
    offIce.spawn("bobsled", 0, 8);
    step(onIce, 2);
    step(offIce, 2);
    const fast = 8 - onIce.zombies[0].x;
    const slow = 8 - offIce.zombies[0].x;
    expect(fast).toBeGreaterThan(slow * 2);
  });
});

describe("升级保留状态", () => {
  it("香蒲升级保留睡莲底座与同格南瓜头", () => {
    const e = pool();
    e.sun = 10000;
    expect(e.plant("lily", 2, 4)).toBe(true);
    expect(e.plant("pumpkin", 2, 4)).toBe(true);
    expect(e.plant("cattail", 2, 4)).toBe(true);
    const ids = e.plants
      .filter((p) => p.row === 2 && p.col === 4)
      .map((p) => p.id);
    expect(ids).toContain("lily");
    expect(ids).toContain("pumpkin");
    expect(ids).toContain("cattail");
  });

  it("已唤醒的大喷菇升级忧郁菇后保持清醒", () => {
    const e = new Engine(1, []);
    e.sun = 10000;
    expect(e.plant("fume", 0, 3)).toBe(true);
    expect(e.plants[0].sleep).toBe(true);
    expect(e.plant("coffee", 0, 3)).toBe(true);
    expect(e.plants[0].sleep).toBe(false);
    expect(e.plant("gloom", 0, 3)).toBe(true);
    const gloom = e.plants.find((p) => p.id === "gloom")!;
    expect(gloom.sleep).toBe(false);
  });
});

describe("每日挑战卡池", () => {
  it("泳池/浓雾关保证睡莲，屋顶关保证花盆", () => {
    // 覆盖全年日期与两种解锁进度，确定性地扫过全部关卡。
    for (let month = 0; month < 12; month++) {
      for (let day = 1; day <= 28; day += 3) {
        for (const unlocked of [1, 25, 50]) {
          const d = dailyChallenge(new Date(2026, month, day), unlocked);
          const level = levels[d.levelId - 1];
          if (["pool", "fog"].includes(level.scene))
            expect(d.cards, `${d.date} 关卡 ${d.levelId} 缺睡莲`).toContain(
              "lily",
            );
          if (level.scene === "roof")
            expect(d.cards, `${d.date} 关卡 ${d.levelId} 缺花盆`).toContain(
              "pot",
            );
        }
      }
    }
  });

  it("卡池不含升级卡与模仿者，且以阳光植物开头", () => {
    for (let day = 1; day <= 28; day += 5) {
      const d = dailyChallenge(new Date(2026, 8, day), 50);
      expect(["sunflower", "sunshroom"]).toContain(d.cards[0]);
      expect(d.cards).not.toContain("imitater");
      expect(new Set(d.cards).size).toBe(d.cards.length);
    }
  });
});
