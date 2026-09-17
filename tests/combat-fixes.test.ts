import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { zombieFrame } from "../src/game/animation";
it("冰冻啃咬停止姿势、攻击和位移", () => {
  const e = new Engine(1, []);
  e.addPlant("wallnut", 0, 4);
  e.spawn("basic", 0, 4.2);
  const z = e.zombies[0];
  e.updateZombie(z, 0.1);
  z.freeze = 3;
  const frame = zombieFrame(z),
    hp = e.plants[0].hp;
  for (let i = 0; i < 10; i++) e.updateZombie(z, 0.1);
  expect(zombieFrame(z)).toBe(frame);
  expect(e.plants[0].hp).toBe(hp);
  expect(z.x).toBe(4.2);
});
it("原目标死亡，豌豆仍能命中后方敌人", () => {
  const e = new Engine(1, []);
  e.addPlant("pea", 0, 0);
  e.spawn("basic", 0, 2);
  e.spawn("basic", 0, 4);
  e.shoot(e.plants[0], e.zombies[0], 20);
  e.plants = [];
  e.zombies[0].hp = 0;
  const target = e.zombies[1];
  e.step(0.016);
  expect(e.shots.length).toBe(1);
  for (let i = 0; i < 60; i++) e.step(0.016);
  expect(target.hp).toBe(180);
});
it("魅惑双方交战互相扣血并停止移动", () => {
  const e = new Engine(1, []);
  e.spawn("basic", 0, 4);
  e.spawn("basic", 0, 4.2);
  e.zombies[0].ally = true;
  e.zombies[0].reverse = true;
  for (const z of e.zombies) e.updateZombie(z, 0.1);
  expect(e.zombies.map((z) => z.hp)).toEqual([100, 100]);
  expect(e.zombies.map((z) => z.x)).toEqual([4, 4.2]);
});
it("种植成功清除选择，失败保留，Shift 连种保留", () => {
  const e = new Engine(1, ["pea"]);
  e.selected = "pea";
  e.click(0, 0, true);
  expect(e.selected).toBe("pea");
  e.click(1, 0);
  expect(e.selected).toBe("pea");
  expect(e.plants.length).toBe(1);
  expect(e.message).toContain("冷却");
  e.cooldowns.pea = 0;
  e.sun = 100;
  e.click(1, 0);
  expect(e.selected).toBe("");
  expect(e.plants.length).toBe(2);
});
it("巨人扔出的小鬼使用连续飞行，冻结时停在半空", () => {
  const e = new Engine(1, []);
  e.spawn("garg", 0, 7);
  e.zombies[0].hp = 100;
  e.updateZombie(e.zombies[0], 0.1);
  expect(e.zombies.some((z) => z.id === "imp")).toBe(false);
  e.updateZombie(e.zombies[0], 0.44);
  expect(e.zombies.some((z) => z.id === "imp")).toBe(false);
  e.updateZombie(e.zombies[0], 0.02);
  const imp = e.zombies.find((z) => z.id === "imp")!;
  expect(imp.x).toBe(7);
  expect(imp.jump).toBeDefined();
  e.updateZombie(imp, 0.1);
  expect(imp.x).toBeLessThan(7);
  expect(imp.x).toBeGreaterThan(3);
  const x = imp.x;
  imp.freeze = 1;
  e.updateZombie(imp, 0.1);
  expect(imp.x).toBe(x);
});
it("烟雾类植物开火时记录攻击时间，头部后坐动作生效", () => {
  for (const id of ["fume", "gloom"] as const) {
    const e = new Engine(11, []);
    const p = e.addPlant(id, 0, 3);
    p.timer = 0;
    e.spawn("basic", 0, 4.2);
    e.step(1 / 60);
    expect(p.attackAge, id).toBe(0);
  }
});
it("大蒜换行保留连续展示的起点", () => {
  const e = new Engine(1, []);
  e.addPlant("garlic", 2, 4);
  e.spawn("basic", 2, 4.2);
  e.updateZombie(e.zombies[0], 0.1);
  expect(e.zombies[0].row).not.toBe(2);
  expect(e.zombies[0].laneChange?.from).toBe(2);
});
