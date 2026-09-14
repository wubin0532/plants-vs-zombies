import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { zombieFrame, chomperFrame, jumpHeight } from "../src/game/animation";

it("跳跃中被击杀的僵尸，死亡特效从空中高度落地", () => {
  const e = new Engine(1, []);
  e.addPlant("wallnut", 0, 4);
  e.spawn("pole", 0, 4.2);
  const z = e.zombies[0];
  e.step(0.02);
  expect(z.jump?.kind).toBe("vault");
  e.step(0.4);
  expect(jumpHeight(z)).toBeGreaterThan(0);
  e.damage(z, 99999, true);
  e.step(0.02);
  const fx = e.effects.find((f) => f.type === "death")!;
  expect(fx.zombie).toBeDefined();
  expect(fx.height).toBeGreaterThan(0);
});

it("弃杆后的撑杆僵尸爬梯时不再渲染持杆起跳帧", () => {
  const e = new Engine(1, []);
  const p = e.addPlant("wallnut", 0, 4);
  e.spawn("pole", 0, 4.2);
  const z = e.zombies[0];
  z.jumped = true;
  p.ladder = true;
  e.updateZombie(z, 0.02);
  expect(z.jump?.kind).toBe("ladder");
  const frame = zombieFrame(z);
  expect(frame < 8 || frame > 11).toBe(true);
});

it("食人花只在吞咽完成后播放消化帧", () => {
  const e = new Engine(1, []);
  const p = e.addPlant("chomper", 0, 4);
  expect(chomperFrame(p)).toBeLessThan(8);
  e.spawn("basic", 0, 4.8);
  p.timer = 0;
  for (let i = 0; i < 6; i++) e.step(0.1);
  expect(p.digest).toBeGreaterThan(0);
  expect(chomperFrame(p)).toBeGreaterThanOrEqual(8);
  expect(chomperFrame(p)).toBeLessThan(12);
});

it("巨人抛出的小鬼从手部高度起飞", () => {
  const e = new Engine(1, []);
  e.spawn("garg", 0, 7);
  const g = e.zombies[0];
  g.hp = g.max / 3;
  e.updateZombie(g, 0.1);
  e.updateZombie(g, 0.5);
  const imp = e.zombies.find((z) => z.id === "imp")!;
  expect(imp.jump?.kind).toBe("throw");
  expect(imp.jump?.fromHeight).toBeGreaterThan(0);
  expect(jumpHeight(imp)).toBeGreaterThan(0);
});

it("寒冰减速同时减半啃咬计时与跳跃进度", () => {
  const e = new Engine(1, []);
  e.spawn("cone", 0, 6);
  e.spawn("cone", 1, 6);
  const [a, b] = e.zombies;
  b.slow = 10;
  e.updateZombie(a, 0.5);
  e.updateZombie(b, 0.5);
  expect(b.actionTime!).toBeCloseTo(a.actionTime! / 2);
  a.jump = { from: a.x, to: a.x - 1, elapsed: 0, duration: 1, kind: "vault" };
  b.jump = { from: b.x, to: b.x - 1, elapsed: 0, duration: 1, kind: "vault" };
  e.updateZombie(a, 0.4);
  e.updateZombie(b, 0.4);
  expect(b.jump!.elapsed).toBeCloseTo(a.jump!.elapsed / 2);
});
