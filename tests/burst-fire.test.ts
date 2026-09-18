import { it, expect, describe } from "vitest";
import { Engine } from "../src/game/engine";
import { dailyChallenge } from "../src/game/daily";
import { levels, plants, isNight, isMushroom } from "../src/game/content";

/** 夜间关卡，蘑菇保持清醒。 */
const night = () => new Engine(11, []);
/** 白天泳池关卡（21 起为泳池场景，2/3 行是水路）。 */
const pool = () => new Engine(21, []);

function step(e: Engine, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) e.step(0.1);
}

/** 累计收集发射闪光的方向（效果会过期，必须逐步累计）。 */
function shootDirections(e: Engine, seconds: number) {
  const seen = new Set<number>();
  const dirs: (number | undefined)[] = [];
  for (let i = 0; i < seconds * 10; i++) {
    e.step(0.1);
    for (const f of e.effects)
      if (f.type === "shoot" && !seen.has(f.uid)) {
        seen.add(f.uid);
        dirs.push(f.direction);
      }
  }
  return dirs;
}

describe("双发/机枪/香蒲真实连发", () => {
  it("双发射手每轮两颗独立弹丸，各 20 伤害且时间错开", () => {
    const e = night();
    e.addPlant("repeater", 0, 2).timer = 0;
    e.spawn("basic", 0, 6);
    const z = e.zombies.at(-1)!;
    e.step(0.1);
    // 第一颗已出膛，第二颗还在排队（隐藏）。
    expect(e.shots).toHaveLength(2);
    expect(e.shots.filter((s) => (s.delay ?? 0) > 0)).toHaveLength(1);
    step(e, 0.2);
    expect(e.shots.every((s) => !(s.delay && s.delay > 0))).toBe(true);
    expect(e.shots.every((s) => s.damage === 20)).toBe(true);
    step(e, 1.2); // 第二轮齐射尚未出膛
    expect(200 - z.hp).toBe(40);
  });

  it("机枪射手每轮四颗，香蒲每轮两枚追踪尖刺", () => {
    const e = night();
    e.addPlant("gatling", 0, 2).timer = 0;
    e.spawn("basic", 0, 7);
    e.step(0.1);
    step(e, 0.5);
    expect(e.shots.filter((s) => s.type === "gatling")).toHaveLength(4);

    const e2 = night();
    e2.addPlant("cattail", 0, 2).timer = 0;
    e2.spawn("basic", 0, 7);
    e2.step(0.1);
    step(e2, 0.3);
    expect(e2.shots.filter((s) => s.type === "cattail")).toHaveLength(2);
    expect(e2.shots.every((s) => s.damage === 20)).toBe(true);
  });

  it("前一目标死亡不吞掉后续弹丸：出膛时重新瞄准", () => {
    const e = night();
    e.addPlant("repeater", 0, 2).timer = 0;
    e.spawn("basic", 0, 5);
    const first = e.zombies.at(-1)!;
    e.spawn("basic", 0, 8);
    const second = e.zombies.at(-1)!;
    e.step(0.1); // 一颗在飞、一颗排队，排队这颗仍瞄准第一个目标
    const queued = e.shots.find((s) => (s.delay ?? 0) > 0)!;
    expect(queued.target).toBe(first.uid);
    e.damage(first, 9999); // 第二颗出膛前目标死亡
    step(e, 0.3);
    const fired = e.shots.find((s) => s.uid === queued.uid)!;
    expect(fired.target).toBe(second.uid); // 改打还活着的目标
    step(e, 1.5);
    expect(second.hp).toBeLessThan(200);
  });

  it("没有任何合法目标时取消队列，不凭空发射", () => {
    const e = night();
    e.addPlant("repeater", 0, 2).timer = 0;
    e.spawn("basic", 0, 5);
    e.step(0.1);
    expect(e.shots.some((s) => (s.delay ?? 0) > 0)).toBe(true);
    e.damage(e.zombies.at(-1)!, 9999); // 唯一的目标立刻死
    const dirs = shootDirections(e, 1);
    expect(dirs).toHaveLength(1); // 只有第一颗出膛
    step(e, 2);
    expect(e.shots).toHaveLength(0);
  });

  it("植物消失时取消它排队的弹丸", () => {
    const e = night();
    e.addPlant("gatling", 0, 2).timer = 0;
    e.spawn("basic", 0, 7);
    e.step(0.1);
    expect(e.shots.some((s) => (s.delay ?? 0) > 0)).toBe(true);
    e.shovel(0, 2);
    const dirs = shootDirections(e, 1);
    expect(dirs).toHaveLength(1); // 铲掉后排队的三颗全部取消
    expect(e.shots.every((s) => !(s.delay && s.delay > 0))).toBe(true);
  });

  it("暂停时连发队列不推进", () => {
    const e = night();
    e.addPlant("repeater", 0, 2).timer = 0;
    e.spawn("basic", 0, 6);
    e.step(0.1);
    const queued = e.shots.find((s) => (s.delay ?? 0) > 0)!;
    const before = queued.delay!;
    e.paused = true;
    step(e, 1);
    expect(queued.delay).toBe(before);
  });
});

describe("三线/裂荚/杨桃发射方式", () => {
  it("三线射手向三条有效路线各发一颗", () => {
    const e = night();
    e.addPlant("three", 1, 2).timer = 0;
    e.spawn("basic", 0, 7);
    e.spawn("basic", 1, 7);
    e.spawn("basic", 2, 7);
    e.step(0.1);
    expect(e.shots).toHaveLength(3);
    expect(new Set(e.shots.map((s) => s.row))).toEqual(new Set([0, 1, 2]));
  });

  it("三线射手在边路只向存在的路线发射", () => {
    const e = night();
    e.addPlant("three", 0, 2).timer = 0;
    e.spawn("basic", 0, 7);
    e.spawn("basic", 1, 7);
    e.step(0.1);
    expect(e.shots).toHaveLength(2);
  });

  it("裂荚射手前方一颗、后方两颗", () => {
    const e = night();
    e.addPlant("split", 0, 4).timer = 0;
    e.spawn("basic", 0, 7);
    e.spawn("basic", 0, 2);
    const dirs = shootDirections(e, 0.6);
    expect(dirs.filter((d) => (d ?? 1) > 0)).toHaveLength(1);
    expect(dirs.filter((d) => (d ?? 1) < 0)).toHaveLength(2);
  });

  it("杨桃每轮固定五颗，数量不随敌人增长", () => {
    const e = night();
    e.addPlant("star", 1, 4).timer = 0;
    e.spawn("basic", 1, 6);
    e.step(0.1);
    expect(e.shots).toHaveLength(5);
    expect(e.shots.map((s) => [s.direction, Math.sign(s.rowSpeed ?? 0)])).toEqual([
      [-1, 0],
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]);
    // 放更多敌人进场，下一轮仍是五颗。
    e.spawn("bucket", 0, 6);
    e.spawn("bucket", 2, 6);
    const star = e.plants.find((p) => p.id === "star")!;
    step(e, 1.5);
    star.timer = 0;
    e.shots.length = 0;
    e.step(0.1);
    expect(e.shots).toHaveLength(5);
  });
});

describe("黄油规则", () => {
  it("发射前确定弹种：黄油伤害翻倍并在命中时定身", () => {
    const e = night();
    e.random = () => 0.1; // 0.1 < 0.25，必出黄油
    e.addPlant("kernel", 0, 2).timer = 0;
    e.spawn("basic", 0, 7);
    const z = e.zombies.at(-1)!;
    e.step(0.1);
    expect(e.shots[0].type).toBe("butter");
    expect(e.shots[0].damage).toBe(40);
    step(e, 3);
    expect(z.freeze).toBeGreaterThan(0);
    expect(200 - z.hp).toBe(40);
  });

  it("普通玉米粒不再命中时才随机，伤害 20 且不定身", () => {
    const e = night();
    e.random = () => 0.9; // 不出黄油
    e.addPlant("kernel", 0, 2).timer = 0;
    e.spawn("basic", 0, 7);
    const z = e.zombies.at(-1)!;
    e.step(0.1);
    expect(e.shots[0].type).toBe("kernel");
    expect(e.shots[0].damage).toBe(20);
    step(e, 3);
    expect(z.freeze).toBe(0);
  });
});

describe("潜水选敌与碰撞一致", () => {
  it("三线射手不向邻行远处的潜水僵尸发射", () => {
    const e = pool();
    e.addPlant("three", 1, 2).timer = 0;
    e.spawn("snorkel", 2, 7);
    const snorkel = e.zombies.at(-1)!;
    e.spawn("basic", 1, 7);
    e.step(0.1);
    expect(e.shots.every((s) => s.target !== snorkel.uid)).toBe(true);
    step(e, 3);
    expect(snorkel.hp).toBe(200);
  });

  it("浮出啃食坚果的潜水僵尸能被后排射手命中", () => {
    const e = pool();
    e.addPlant("pea", 2, 1).timer = 0;
    e.addPlant("wallnut", 2, 4);
    e.spawn("snorkel", 2, 4.45);
    const z = e.zombies.at(-1)!;
    z.action = "eat"; // 正在啃坚果，已经浮出
    step(e, 3);
    expect(z.hp).toBeLessThan(200);
  });
});

describe("孢子飞行距离", () => {
  it("小喷菇的孢子飞三格后消散，近处目标先死也不会继续飞", () => {
    const e = night();
    e.addPlant("puff", 0, 1).timer = 0;
    e.spawn("basic", 0, 3.5); // 三格内，但不会同帧命中
    const z = e.zombies.at(-1)!;
    e.step(0.1);
    expect(e.shots).toHaveLength(1);
    z.hp = 0; // 目标先死，弹丸继续飞
    let maxX = 0;
    for (let i = 0; i < 30; i++) {
      e.step(0.1);
      if (e.shots[0]) maxX = Math.max(maxX, e.shots[0].x);
    }
    expect(e.shots).toHaveLength(0);
    expect(maxX).toBeLessThan(4.6); // 出膛 1.35 + 3 格
  });
});

describe("玉米炮右半格操作", () => {
  it("点击任意半格都转到主炮瞄准", () => {
    const e = night();
    e.sun = 10000;
    e.cooldowns = {};
    e.addPlant("kernel", 0, 3);
    e.addPlant("kernel", 0, 4);
    expect(e.plant("cob", 0, 3)).toBe(true);
    const main = e.plants.find((p) => p.id === "cob" && p.col === 3)!;
    main.timer = 0;
    e.step(0.1);
    expect(main.ready).toBe(true);
    e.click(0, 4); // 点的是右半格
    expect(e.cannon).toBe(main.uid);
  });
});

describe("每日卡池可用火力", () => {
  const attackKinds = new Set([
    "electric",
    "shooter",
    "shroom",
    "lob",
    "homing",
    "fume",
    "gloom",
    "star",
    "spike",
  ]);
  const works = (cards: string[], scene: string) =>
    cards.some((id) => {
      const d = plants.find((p) => p.id === id);
      return (
        d &&
        attackKinds.has(d.kind) &&
        (isNight(scene) || !isMushroom(id) || cards.includes("coffee"))
      );
    });

  it("回归 2026-02-15 / 解锁 50：当日卡池有可工作攻击方案", () => {
    const d = dailyChallenge(new Date(2026, 1, 15), 50);
    const scene = levels.find((l) => l.id === d.levelId)!.scene;
    expect(works(d.cards, scene)).toBe(true);
  });

  it("全年日期与解锁进度组合都有可工作卡池与必要植物", () => {
    for (let m = 0; m < 12; m++)
      for (let day = 1; day <= 28; day++)
        for (const unlocked of [1, 10, 25, 50]) {
          const d = dailyChallenge(new Date(2026, m, day), unlocked);
          const scene = levels.find((l) => l.id === d.levelId)!.scene;
          expect(works(d.cards, scene)).toBe(true);
          if (["pool", "fog"].includes(scene))
            expect(d.cards).toContain("lily");
          if (scene === "roof") expect(d.cards).toContain("pot");
        }
  });
});

describe("冰火与溅射回归", () => {
  it("双发豌豆逐个过火炬，两颗都变火球", () => {
    const e = night();
    e.addPlant("repeater", 0, 1).timer = 0;
    e.addPlant("torch", 0, 3);
    e.spawn("basic", 0, 7);
    const z = e.zombies.at(-1)!;
    step(e, 1.4); // 第二轮齐射尚未命中
    // 每颗火球 40，两颗共 80。
    expect(200 - z.hp).toBe(80);
  });

  it("冰豌豆命中减速，西瓜命中溅射邻近僵尸", () => {
    const e = night();
    e.addPlant("snowpea", 0, 2).timer = 0;
    e.spawn("basic", 0, 7);
    const z = e.zombies.at(-1)!;
    step(e, 3);
    expect(z.slow).toBeGreaterThan(0);

    const e2 = night();
    e2.addPlant("melon", 0, 2).timer = 0;
    e2.spawn("basic", 0, 7);
    e2.spawn("basic", 0, 7.5);
    const target = e2.zombies.at(-2)!;
    const near = e2.zombies.at(-1)!;
    step(e2, 4);
    expect(target.hp).toBeLessThan(200);
    expect(near.hp).toBeLessThan(200);
  });
});
