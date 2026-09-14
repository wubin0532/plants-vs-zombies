import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { zombieFrame, chomperFrame } from "../src/game/animation";
import { plantById, zombieById } from "../src/game/content";

it("魅惑巨人抛出同阵营小鬼，并朝敌方方向飞行", () => {
  const e = new Engine(1, []);
  e.spawn("garg", 0, 3);
  const giant = e.zombies[0];
  giant.ally = giant.reverse = true;
  giant.hp = giant.max / 3;
  e.updateZombie(giant, 0.1);
  e.updateZombie(giant, 0.5);
  const imp = e.zombies.find(z => z.id === "imp")!;
  expect(imp.ally).toBe(true);
  expect(imp.reverse).toBe(true);
  expect(imp.jump?.to).toBe(7);
  e.updateZombie(giant, 0.5);
  e.updateZombie(giant, 0.5);
  expect(e.zombies.filter(z => z.id === "imp")).toHaveLength(1);
});

it("巨人挥棒在落棒帧结算一次，冻结保留蓄力", () => {
  const e = new Engine(1, []);
  e.addPlant("tallnut", 0, 4);
  e.spawn("garg", 0, 4.2);
  const z = e.zombies[0], p = e.plants[0];
  e.updateZombie(z, 0.01);
  expect(zombieFrame(z)).toBe(8);
  e.updateZombie(z, 0.3);
  expect(p.hp).toBe(p.max);
  const frame = zombieFrame(z);
  z.freeze = 1;
  e.updateZombie(z, 0.5);
  expect(zombieFrame(z)).toBe(frame);
  expect(p.hp).toBe(p.max);
  z.freeze = 0;
  e.updateZombie(z, 0.11);
  expect(zombieFrame(z)).toBe(10);
  expect(p.hp).toBe(0);
  e.updateZombie(z, 0.3);
  expect(p.hp).toBe(0);
});

it("挥棒蓄力期间目标被铲除，不伤害后来种下的植物", () => {
  const e = new Engine(1, []);
  e.addPlant("wallnut", 0, 4);
  e.spawn("garg", 0, 4.2);
  e.updateZombie(e.zombies[0], 0.01);
  e.shovel(0, 4);
  e.addPlant("pea", 0, 4);
  e.updateZombie(e.zombies[0], 0.45);
  expect(e.plants[0].hp).toBe(e.plants[0].max);
});

it("撑杆在跳跃、落地和弃杆后连续切换，落地后速度减半", () => {
  const e = new Engine(1, []);
  e.addPlant("wallnut", 0, 4);
  e.spawn("pole", 0, 4.2);
  const z = e.zombies[0];
  e.updateZombie(z, 0.01);
  expect(zombieFrame(z)).toBe(8);
  e.updateZombie(z, 0.4);
  expect(zombieFrame(z)).toBeGreaterThan(8);
  expect(z.x).toBeLessThan(4.2);
  e.updateZombie(z, 0.5);
  expect(z.jump).toBeUndefined();
  expect(zombieFrame(z)).toBeGreaterThanOrEqual(12);
  expect(zombieFrame(z)).toBeLessThan(20);
  const x = z.x;
  e.updateZombie(z, 0.5);
  expect(x - z.x).toBeCloseTo(zombieById.pole.speed / 96 * 0.25);
});

it("食人花在咬合帧吞噬，消化和暂停都不会重复造成伤害", () => {
  const e = new Engine(1, []);
  e.addPlant("chomper", 0, 4);
  e.spawn("basic", 0, 4.8);
  const p = e.plants[0], z = e.zombies[0];
  p.timer = 0;
  e.step(0.1);
  expect(chomperFrame(p)).toBe(4);
  expect(z.hp).toBe(z.max);
  e.paused = true;
  e.step(1);
  expect(chomperFrame(p)).toBe(4);
  expect(z.hp).toBe(z.max);
  e.paused = false;
  e.step(0.1);
  e.step(0.1);
  expect(chomperFrame(p)).toBe(6);
  expect(z.swallowed).toBe(true);
  expect(e.kills).toBe(1);
  for (let i = 0; i < 8; i++) e.step(0.1);
  expect(chomperFrame(p)).toBeGreaterThanOrEqual(8);
  expect(chomperFrame(p)).toBeLessThan(12);
  expect(e.kills).toBe(1);
});

it("强化护甲保护本体，南瓜保护内层，敏捷敌人比普通敌人更快", () => {
  const e = new Engine(1, []);
  e.addPlant("pea", 0, 4);
  e.addPlant("pumpkin", 0, 4);
  e.spawn("basic", 0, 4.2);
  e.updateZombie(e.zombies[0], 0.1);
  expect(e.at(0, 4, "main")?.hp).toBe(plantById.pea.hp);
  expect(e.at(0, 4, "armor")?.hp).toBe(4900);
  e.spawn("football", 1, 8);
  const football = e.zombies[1];
  e.damage(football, 1600);
  expect(football.hp).toBe(300);
  expect(football.armor).toBe(100);
  e.damage(football, 200);
  expect(football.hp).toBe(200);
  expect(football.armor).toBe(0);
  e.spawn("basic", 2, 8);
  e.updateZombie(football, 1);
  e.updateZombie(e.zombies[2], 1);
  expect(8 - football.x).toBeGreaterThan((8 - e.zombies[2].x) * 2.5);
});
