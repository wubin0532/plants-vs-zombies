import { expect, it } from "vitest";
import { Engine } from "../src/game/engine";
import { laneStrength } from "../src/game/director";
import { jumpHeight, zombiePose } from "../src/game/animation";

it("总攻真实主力进入预告行，且泳池预告不指向陆生僵尸无法进入的水路", () => {
  for (const level of [8, 28]) {
    const e = new Engine(level, [], 42);
    e.composeWave(3);
    const row = e.assaultAlert!.row;
    expect(e.water(row)).toBe(false);
    e.wave = 4;
    let matches = 0;
    for (let i = 0; i < 200; i++) {
      e.spawn("basic");
      if (e.zombies.at(-1)!.row === row) matches++;
      e.zombies.pop();
    }
    expect(matches).toBeGreaterThan(110);
  }
});
it("水生僵尸保留指定水路；自主选路能识别水路防线", () => {
  const e = new Engine(28, [], 42);
  e.spawn("snorkel", 3);
  expect(e.zombies[0].row).toBe(3);
  e.zombies = [];
  for (let c = 0; c < 4; c++) e.addPlant("pea", 2, c);
  let weakLane = 0;
  for (let i = 0; i < 200; i++) {
    e.spawn("dolphin");
    const row = e.zombies.at(-1)!.row;
    expect([2, 3]).toContain(row);
    if (row === 3) weakLane++;
    e.zombies.pop();
  }
  expect(weakLane).toBeGreaterThan(130);
});
it("舞王不把陆生伴舞召唤进水池", () => {
  const e = new Engine(28, [], 42);
  e.spawn("dancer", 1, 6);
  e.updateZombie(e.zombies[0], 0.01);
  e.updateZombie(e.zombies[0], 0.5);
  // 上路 + 同行前后；水路（行 2）跳过。
  expect(e.zombies.filter(z => z.id === "backup").map(z => z.row)).toEqual([0, 1, 1]);
});
it("僵尸跳过已经死亡的南瓜，攻击其下仍存活的植物", () => {
  const e = new Engine(1, []);
  const pea = e.addPlant("pea", 0, 4);
  const shell = e.addPlant("pumpkin", 0, 4);
  shell.hp = 0;
  e.spawn("basic", 0, 4.2);
  e.updateZombie(e.zombies[0], 0.1);
  expect(pea.hp).toBe(pea.max - 100);
  expect(shell.hp).toBe(0);
});
it("减速同时放慢攻击冷却和动作时间，冻结保持当前阶段", () => {
  const e = new Engine(1, []);
  const p = e.addPlant("wallnut", 0, 4);
  e.spawn("basic", 0, 4.2);
  const z = e.zombies[0];
  z.slow = 10;
  e.updateZombie(z, 0.1);
  const hp = p.hp;
  for (let i = 0; i < 10; i++) e.updateZombie(z, 0.1);
  expect(p.hp).toBe(hp);
  expect(z.actionTime).toBeCloseTo(0.5);
  z.freeze = 1;
  const timer = z.timer, clock = z.actionTime;
  e.updateZombie(z, 0.4);
  expect(z.timer).toBe(timer);
  expect(z.actionTime).toBe(clock);
  z.freeze = 0;
  for (let i = 0; i < 11; i++) e.updateZombie(z, 0.1);
  expect(p.hp).toBe(hp - 100);
});
it("魅惑玩偶匣炸敌人，不伤害植物和同阵营僵尸", () => {
  const e = new Engine(1, []);
  const plant = e.addPlant("pea", 0, 4);
  e.spawn("jack", 0, 4);
  e.spawn("basic", 0, 4.5);
  const [jack, enemy] = e.zombies;
  jack.ally = jack.reverse = true;
  jack.age = 16;
  e.random = () => 0;
  e.updateZombie(jack, 0.1);
  expect(enemy.hp).toBeLessThanOrEqual(0);
  expect(e.plants).toContain(plant);
  expect(plant.hp).toBe(plant.max);
});
it("蹦极偷走植物会计入导演的受挫保护，铲除不计入", () => {
  const e = new Engine(1, []);
  e.addPlant("pea", 0, 4);
  e.spawn("bungee", 0, 4);
  const z = e.zombies[0];
  z.x = 4;
  z.age = 6;
  e.updateZombie(z, 0.1);
  expect(e.plantsLost).toBe(1);
  const p = e.addPlant("pea", 1, 4);
  e.remove(p);
  expect(e.plantsLost).toBe(1);
});
it("已死亡或休眠的射手不会虚增防线火力", () => {
  const e = new Engine(1, []);
  const p = e.addPlant("pea", 0, 4);
  expect(laneStrength(e.plants, [], 0)).toBeGreaterThan(0);
  p.sleep = true;
  expect(laneStrength(e.plants, [], 0)).toBe(0);
  p.sleep = false; p.hp = 0;
  expect(laneStrength(e.plants, [], 0)).toBe(0);
});
it("漂浮姿态由行走平滑收回到啃咬，跳跳起跳保留原高度", () => {
  const e = new Engine(1, []);
  e.spawn("ducky", 0, 5);
  const z = e.zombies[0];
  z.motion = 4; z.actionTime = 1;
  const walking = zombiePose(z);
  z.action = "eat"; z.actionTime = 0;
  expect(zombiePose(z)).toEqual(walking);
  z.actionTime = 0.16;
  expect(zombiePose(z)).toEqual({angle: 0, lift: 0});
  e.addPlant("pea", 0, 4);
  e.spawn("pogo", 0, 4.2);
  const pogo = e.zombies.at(-1)!;
  pogo.motion = 4; pogo.actionTime = 1;
  const height = jumpHeight(pogo);
  e.updateZombie(pogo, 0.01);
  expect(pogo.jump?.fromHeight).toBe(height);
  expect(jumpHeight(pogo)).toBe(height);
});
it("备用车信息正确，出动动画早于胜利延时结束", () => {
  const e = new Engine(1, []);
  e.spareMowers[0] = true;
  e.spawn("basic", 0, -0.7);
  e.updateZombie(e.zombies[0], 0.01);
  expect(e.message).toContain("还有一台备用车");
  expect(e.effects.find(f => f.type === "mower")!.duration).toBeLessThan(0.35);
});
