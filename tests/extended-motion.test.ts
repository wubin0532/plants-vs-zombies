import { expect, it } from "vitest";
import { Engine } from "../src/game/engine";
import { plantHeadPose, zombieFrame, zombiePose } from "../src/game/animation";

it("舞王召唤在中段结算一次，冻结暂停并继承魅惑阵营", () => {
  const e = new Engine(1, []);
  e.spawn("dancer", 2, 6);
  const z = e.zombies[0];
  z.ally = z.reverse = true;
  e.updateZombie(z, 0.01);
  expect(zombieFrame(z)).toBe(12);
  e.updateZombie(z, 0.3);
  expect(e.zombies).toHaveLength(1);
  const frame = zombieFrame(z), x = z.x;
  z.freeze = 1;
  e.updateZombie(z, 0.5);
  expect(zombieFrame(z)).toBe(frame);
  expect(z.x).toBe(x);
  z.freeze = 0;
  e.updateZombie(z, 0.16);
  // 上下左右共 4 只伴舞（舞王 + 4 = 5）。
  expect(e.zombies).toHaveLength(5);
  for (const backup of e.zombies.slice(1)) {
    expect(backup.ally).toBe(true);
    expect(backup.reverse).toBe(true);
  }
  e.updateZombie(z, 0.5);
  e.updateZombie(z, 0.1);
  expect(e.zombies).toHaveLength(5);
  expect(z.special).toBeUndefined();
});
it("边行舞王不会召唤到棋盘外，减速召唤动作延长", () => {
  const e = new Engine(1, []);
  e.spawn("dancer", 0, 6);
  const z = e.zombies[0];
  z.slow = 10;
  e.updateZombie(z, 0.01);
  e.updateZombie(z, 0.6);
  expect(e.zombies).toHaveLength(1);
  e.updateZombie(z, 0.4);
  // 上/左/右可召唤（下越界跳过）：舞王行 0，伴舞行 1、0、0，绝不出现 -1。
  expect(e.zombies.map(z => z.row)).toEqual([0, 1, 0, 0]);
});
for (const id of ["dancer", "backup", "pogo", "balloon", "football"]) {
  it(`${id} 动作有差异，冻结时姿态不漂移`, () => {
    const e = new Engine(1, []);
    e.spawn(id, 0, 6);
    const z = e.zombies[0];
    z.timer = 100;
    // 舞王用独立召唤计时，压住它避免测试期间进入召唤动作。
    z.summonTimer = 100;
    const first = zombiePose(z);
    e.updateZombie(z, 0.3);
    expect(zombiePose(z)).not.toEqual(first);
    const pose = zombiePose(z);
    z.freeze = 2;
    e.updateZombie(z, 0.2);
    expect(zombiePose(z)).toEqual(pose);
  });
}
it("植物上部独立响应发射与投掷，休眠不蓄力", () => {
  const e = new Engine(1, []);
  e.addPlant("pea", 0, 0);
  const p = e.plants[0];
  p.attackAge = 0.2;
  const shot = plantHeadPose(p, "shooter");
  expect(shot.scaleX).toBeLessThan(1);
  expect(plantHeadPose(p, "lob").angle).toBeGreaterThan(shot.angle);
  p.sleep = true;
  expect(plantHeadPose(p, "shroom")).toEqual({ angle: 0, scaleX: 1, scaleY: 1 });
});
