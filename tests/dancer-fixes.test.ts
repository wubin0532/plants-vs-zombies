import { expect, it } from "vitest";
import { Engine } from "../src/game/engine";
import { zombieById } from "../src/game/content";

const fresh = (level = 1) => {
  const e = new Engine(level, [], 42);
  e.schedule = [];
  e.eventAt = -1;
  return e;
};

it("舞王属性：速度不快于普通，counters 指向克制植物", () => {
  expect(zombieById.dancer.hp).toBe(500);
  expect(zombieById.dancer.armor).toBe(0);
  expect(zombieById.dancer.speed).toBe(10);
  expect(zombieById.backup.speed).toBe(10);
  expect(zombieById.dancer.counters).toEqual(["squash", "cherry", "hypno"]);
});

it("舞王召唤上下左右共 4 只伴舞", () => {
  const e = fresh();
  e.spawn("dancer", 2, 6);
  const z = e.zombies[0];
  e.updateZombie(z, 0.01);
  e.updateZombie(z, 0.5);
  const backups = e.zombies.filter((q) => q.id === "backup");
  expect(backups).toHaveLength(4);
  expect(new Set(backups.map((b) => b.row))).toEqual(new Set([1, 2, 3]));
  expect(backups.filter((b) => b.row === 2)).toHaveLength(2);
});

it("舞王召唤有上限：满 4 只不再增援，减员后补回 4 只", () => {
  const e = fresh();
  e.spawn("dancer", 2, 6);
  const z = e.zombies[0];
  e.updateZombie(z, 0.01);
  e.updateZombie(z, 0.5);
  expect(e.zombies.filter((q) => q.id === "backup")).toHaveLength(4);
  // 跑过多个召唤周期，数量不增长
  for (let i = 0; i < 600; i++) e.updateZombie(z, 0.1);
  expect(e.zombies.filter((q) => q.id === "backup")).toHaveLength(4);
  // 杀掉 2 只，下一个周期只补到 4
  const alive = e.zombies.filter((q) => q.id === "backup");
  alive[0].hp = 0;
  alive[1].hp = 0;
  z.summonTimer = 0;
  z.timer = 5;
  e.updateZombie(z, 0.01);
  e.updateZombie(z, 0.5);
  expect(e.zombies.filter((q) => q.id === "backup" && q.hp > 0)).toHaveLength(4);
});

it("舞王能啃食植物（召唤计时与啃食计时分离）", () => {
  const e = fresh();
  const wall = e.addPlant("wallnut", 0, 4);
  e.spawn("dancer", 0, 4.2);
  const z = e.zombies[0];
  for (let i = 0; i < 60; i++) e.updateZombie(z, 0.1);
  expect(wall.hp).toBeLessThan(wall.max);
  expect(z.action).toBe("eat");
});

it("边行舞王不召唤到棋盘外，水中不召唤", () => {
  const e = fresh();
  e.spawn("dancer", 0, 6);
  const z = e.zombies[0];
  e.updateZombie(z, 0.01);
  e.updateZombie(z, 0.5);
  const rows = e.zombies
    .filter((q) => q.id === "backup")
    .map((b) => b.row);
  expect(rows.every((r) => r >= 0 && r < e.level.rows)).toBe(true);
  expect(rows).not.toContain(-1);

  const pool = fresh(28);
  pool.spawn("dancer", 1, 6);
  const pz = pool.zombies[0];
  pool.updateZombie(pz, 0.01);
  pool.updateZombie(pz, 0.5);
  const prows = pool.zombies
    .filter((q) => q.id === "backup")
    .map((b) => b.row);
  expect(prows).not.toContain(2);
  expect(prows).not.toContain(3);
});

it("伴舞记录自己的舞王，便于按舞王统计上限", () => {
  const e = fresh();
  e.spawn("dancer", 2, 6);
  const z = e.zombies[0];
  e.updateZombie(z, 0.01);
  e.updateZombie(z, 0.5);
  for (const b of e.zombies.filter((q) => q.id === "backup"))
    expect(b.summoner).toBe(z.uid);
});
