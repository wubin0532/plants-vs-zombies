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

it("爆炸与地刺仍然直接伤及本体（设计如此）", () => {
  const e = new Engine(1, []);
  e.spawn("football", 0, 4);
  const z = e.zombies[0];
  e.blast(4, 0, 1.5);
  expect(z.hp).toBeLessThanOrEqual(0);

  const spike = new Engine(1, []);
  spike.spawn("bucket", 0, 4);
  const bucket = spike.zombies[0];
  fire(spike, "spike", 0, 4);
  expect(bucket.hp, "地刺扎脚，无视头盔").toBeLessThan(bucket.max);
  expect(bucket.armor).toBe(bucket.maxArmor);
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
