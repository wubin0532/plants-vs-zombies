import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";

/** 蘑菇类植物白天会睡觉，用夜间关卡测试它们的攻击判定。 */
const night = () => new Engine(11, []);

/** 种下植物并让它立刻出手。 */
function fire(e: Engine, id: string, row = 0, col = 3) {
  const p = e.addPlant(id, row, col);
  p.timer = 0;
  e.step(0.1);
  return p;
}

it("大喷菇的烟雾越过铁栅门，但打不穿铁桶和橄榄球护甲", () => {
  const door = night();
  door.spawn("screen", 0, 4.5);
  const gate = door.zombies[0];
  fire(door, "fume");
  expect(gate.hp, "烟雾应该越过铁门打到本体").toBeLessThan(gate.max);
  expect(gate.armor, "铁门不会被烟雾消耗").toBe(gate.maxArmor);

  for (const id of ["bucket", "football", "cone"]) {
    const e = night();
    e.spawn(id, 0, 4.5);
    const z = e.zombies[0];
    fire(e, "fume");
    expect(z.hp, `${id} 本体不该被烟雾直接打掉`).toBe(z.max);
    expect(z.armor, `${id} 护甲应该吸收烟雾`).toBeLessThan(z.maxArmor);
  }
});

it("忧郁菇沿用同一套判定：越过铁门，但不越过头盔", () => {
  const door = night();
  door.spawn("screen", 0, 4);
  const gate = door.zombies[0];
  fire(door, "gloom");
  expect(gate.hp).toBeLessThan(gate.max);
  expect(gate.armor).toBe(gate.maxArmor);

  const helmet = night();
  helmet.spawn("football", 0, 4);
  const z = helmet.zombies[0];
  fire(helmet, "gloom");
  expect(z.hp).toBe(z.max);
  expect(z.armor).toBeLessThan(z.maxArmor);
});

it("投手的抛物线越过铁栅门，但对头盔仍要先破甲", () => {
  const lob = (id: string) => {
    const e = new Engine(1, []);
    e.addPlant("cabbage", 0, 2);
    e.plants[0].timer = 0;
    e.spawn(id, 0, 6);
    for (let i = 0; i < 60; i++) e.step(0.1);
    return e.zombies[0];
  };
  const gate = lob("screen");
  expect(gate.hp).toBeLessThan(gate.max);
  expect(gate.armor).toBe(gate.maxArmor);
  const helmet = lob("bucket");
  expect(helmet.armor).toBeLessThan(helmet.maxArmor);
});

it("正面豌豆依旧被铁栅门挡下", () => {
  const e = new Engine(1, []);
  e.spawn("screen", 0, 5);
  const z = e.zombies[0];
  e.damage(z, 20);
  expect(z.hp).toBe(z.max);
  expect(z.armor).toBe(z.maxArmor - 20);
});

it("寒冰豌豆被铁栅门挡下时不施加冻缓，破门后才减速", () => {
  const hit = (armor: number) => {
    const e = night();
    e.spawn("screen", 0, 5);
    const z = e.zombies[0];
    z.armor = armor;
    const p = e.addPlant("snowpea", 0, 2);
    p.timer = 0;
    for (let i = 0; i < 240 && z.hp === z.max; i++) e.step(1 / 60);
    return z;
  };
  const blocked = hit(1350);
  expect(blocked.hp, "被铁门挡下时本体不掉血").toBe(blocked.max);
  expect(blocked.slow, "被挡下的冰豌豆不应施加冻缓").toBe(0);
  const broken = hit(0);
  expect(broken.hp).toBeLessThan(broken.max);
  expect(broken.slow, "打中本体应施加冻缓").toBeGreaterThan(0);
});

it("爆炸直接伤及本体，但地刺的刺伤会被护甲挡下", () => {
  const e = new Engine(1, []);
  e.spawn("football", 0, 4);
  const z = e.zombies[0];
  e.blast(4, 0, 1.5);
  expect(z.hp).toBeLessThanOrEqual(0);

  // 平衡性：地刺不再无视护甲，否则满铺地刺即可无视一切护甲通关。
  const spike = new Engine(1, []);
  spike.spawn("bucket", 0, 4);
  const bucket = spike.zombies[0];
  fire(spike, "spike", 0, 4);
  expect(bucket.hp, "护甲应该保护本体不被刺伤穿透").toBe(bucket.max);
  expect(bucket.armor, "铁桶应该先吸收刺伤").toBeLessThan(bucket.maxArmor);

  // 护甲耗尽后刺伤开始掉本体血量。
  const bare = new Engine(1, []);
  bare.spawn("bucket", 0, 4);
  bare.zombies[0].armor = 0;
  const body = bare.zombies[0];
  fire(bare, "spike", 0, 4);
  expect(body.hp, "破甲后地刺照常伤害本体").toBeLessThan(body.max);
});

it("巨人僵尸会砸掉地刺，地刺王能扛住多次砸击", () => {
  // 返回砸毁植物所需的模拟步数（1/30 秒每步）。
  const crush = (id: string) => {
    const e = new Engine(1, []);
    const p = e.addPlant(id, 0, 4);
    e.spawn("garg", 0, 4.2);
    let steps = 0;
    for (; steps < 900 && p.hp > 0; steps++) e.step(1 / 30);
    return steps;
  };
  const weedSteps = crush("spike");
  const rockSteps = crush("spikerock");
  expect(weedSteps, "地刺应该被巨人砸掉").toBeLessThan(900);
  expect(rockSteps, "地刺王 900 血，每锤 300，应明显扛得更久").toBeGreaterThan(
    weedSteps,
  );
});

it("平衡性：满铺一行地刺耗得死普通僵尸，但护甲僵尸能突破", () => {
  const siege = (id: string) => {
    const e = new Engine(1, [], 7, {
      difficulty: "custom",
      minutes: 5,
      density: 1,
      health: 1,
      speed: 1,
      sun: 150,
      prep: 10,
      mowers: false,
    });
    e.schedule = [];
    for (let c = 0; c < 9; c++) e.addPlant("spike", 0, c);
    e.spawn(id, 0, 9);
    for (let i = 0; i < 1400 && e.status === "playing"; i++) e.step(0.1);
    return e;
  };
  const basic = siege("basic");
  expect(basic.status, "普通僵尸应被满铺地刺耗死").toBe("playing");
  const bucket = siege("bucket");
  expect(bucket.status, "铁桶僵尸应突破纯地刺防线").toBe("lost");
});

it("磁力菇吸走头盔、铁门、梯子、跳杆、矿镐与玩偶匣", () => {
  const disarm = (id: string) => {
    const e = night();
    const p = e.addPlant("magnet", 0, 2);
    e.spawn(id, 0, 4);
    e.zombies[0].underground = false;
    p.timer = 0;
    e.step(0.1);
    return { e, z: e.zombies[0] };
  };
  for (const id of ["bucket", "screen", "football", "ladder"])
    expect(disarm(id).z.armor, `${id} 的护甲应该被吸走`).toBe(0);
  for (const id of ["pogo", "digger", "ladder"])
    expect(disarm(id).z.jumped, `${id} 的工具应该被吸走`).toBe(true);

  // 玩偶匣被吸走后不再自爆。
  const { e, z } = disarm("jack");
  expect(z.disarmed).toBe(true);
  e.addPlant("pea", 0, 5);
  e.random = () => 0;
  z.age = 16;
  e.updateZombie(z, 0.1);
  expect(e.plants.some((p) => p.id === "pea"), "植物不该被炸掉").toBe(true);
});
