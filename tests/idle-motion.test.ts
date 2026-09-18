import { expect, it } from "vitest";
import { Engine } from "../src/game/engine";
import { plants } from "../src/game/content";
import { chomperFrame, plantMotionFrame } from "../src/game/animation";
import { plantIdlePose } from "../src/game/presentation";
import { plantIdleRange } from "../src/game/idle-motion.generated";

const framesOver = (p: any, fn: (p: any) => number, seconds = 12) => {
  const seen = new Set<number>();
  for (let t = 0; t < seconds; t += 0.05) {
    p.age = t;
    seen.add(fn(p));
  }
  return seen;
};

it("待机幅度表覆盖全部植物且为非负数", () => {
  for (const def of plants) {
    expect(typeof plantIdleRange[def.id], def.id).toBe("number");
    expect(plantIdleRange[def.id]).toBeGreaterThanOrEqual(0);
  }
});

it("待机按植物分开：幅度大的保持基准帧，幅度小的慢速循环", () => {
  const e = new Engine(11, []);
  const pea = e.addPlant("pea", 0, 4); // 幅度 33：只呼吸不换帧
  const star = e.addPlant("star", 0, 5); // 幅度 4：小幅慢速循环
  expect([...framesOver(pea, plantMotionFrame)]).toEqual([0]);
  const starFrames = framesOver(star, plantMotionFrame);
  expect(starFrames.size).toBeGreaterThan(1);
  expect([...starFrames].every((f) => f >= 0 && f < 8)).toBe(true);
});

it("大嘴花待机保持咀嚼循环，是待机最活跃的植物", () => {
  const e = new Engine(11, []);
  const chomper = e.addPlant("chomper", 0, 4);
  const seen = framesOver(chomper, chomperFrame, 3);
  expect(seen.size).toBeGreaterThan(1);
  expect([...seen].every((f) => f >= 0 && f < 4)).toBe(true);
});

it("待机程序化动作按类型区分、只影响表现", () => {
  const e = new Engine(11, []);
  const span = (p: any) => {
    let min = Infinity, max = -Infinity;
    for (let t = 0; t < 10; t += 0.05) {
      p.age = t;
      const a = plantIdlePose(p).angle;
      min = Math.min(min, a); max = Math.max(max, a);
    }
    return max - min;
  };
  const blover = e.addPlant("blover", 0, 5);
  const nut = e.addPlant("wallnut", 0, 6);
  expect(span(blover)).toBeGreaterThan(8);
  expect(span(nut)).toBeLessThan(1);

  const bob = (p: any) => {
    let min = Infinity, max = -Infinity;
    for (let t = 0; t < 10; t += 0.05) {
      p.age = t;
      const y = plantIdlePose(p).offsetY;
      min = Math.min(min, y); max = Math.max(max, y);
    }
    return max - min;
  };
  const pea = e.addPlant("pea", 0, 4);
  expect(bob(pea)).toBeGreaterThan(2); // 不换帧的植物也有明显的呼吸起伏

  for (const def of plants) {
    const p = e.addPlant(def.id, 1, 4);
    p.age = 1.3;
    const before = JSON.stringify(p);
    const pose = plantIdlePose(p);
    expect(Object.values(pose).every(Number.isFinite), def.id).toBe(true);
    expect(JSON.stringify(p), def.id).toBe(before);
  }
});

it("休眠植物不叠加待机动作", () => {
  const e = new Engine(11, []);
  const p = e.addPlant("pea", 0, 4);
  p.sleep = true;
  p.age = 3;
  expect(plantIdlePose(p)).toEqual({ scaleX: 1, scaleY: 1, angle: 0, offsetY: 0 });
});
