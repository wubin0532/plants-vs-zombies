import { expect, it } from "vitest";
import { Engine } from "../src/game/engine";
import { applyControl } from "../src/game/elements";
import { tokenPose, weatherOpacity } from "../src/game/ambient";
import { cellY } from "../src/game/layout";

const run = (e: Engine, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.step(1 / 60);
};
it("寒风对新老僵尸使用同一个截止时间，结束后不残留天气减速", () => {
  const e = new Engine(8, []);
  e.eventKind = "wind"; e.eventAt = 0.1;
  e.spawn("basic", 0, 8); run(e, 3);
  e.spawn("basic", 1, 8);
  expect(e.zombies[1].weatherSlow).toBeCloseTo(e.windUntil - e.time);
  run(e, 3);
  for (const z of e.zombies) expect(z.weatherSlow).toBeCloseTo(e.windUntil - e.time);
  run(e, 3);
  for (const z of e.zombies) expect(z.weatherSlow).toBe(0);
  e.spawn("basic", 2, 8); expect(e.zombies.at(-1)!.slow).toBe(0);
});
it("天气不触发冰电，冰电消耗冰冻后保留天气减速", () => {
  const e = new Engine(8, []);
  e.eventKind = "wind"; e.eventAt = 0.1; e.spawn("bucket", 0, 8); run(e, 1);
  const z = e.zombies[0]; e.electricHit(z, 20); expect(e.reactions).toBe(0);
  applyControl(z, "iceFreeze", 4); e.electricHit(z, 20);
  expect(e.reactions).toBe(1); expect(z.freeze).toBe(0);
  expect(z.slow).toBeCloseTo(e.windUntil - e.time);
});
it("天气渐入渐出，期限前后透明度为零", () => {
  expect(weatherOpacity(10, 18, 8)).toBe(0);
  expect(weatherOpacity(10.3, 18, 8)).toBeGreaterThan(0);
  expect(weatherOpacity(12, 18, 8)).toBe(1);
  expect(weatherOpacity(17.8, 18, 8)).toBeLessThan(0.2);
  expect(weatherOpacity(18, 18, 8)).toBe(0);
});
it("下落阳光中途收集从当前画面位置飞出，且只到账一次", () => {
  const e = new Engine(8, []);
  e.token(4, 3, 25, false, "sky");
  const token = e.tokens[0]; token.age = 0.8;
  const pose = tokenPose(token, e.level.rows);
  expect(pose.y).toBeLessThan(cellY(3, e.level.rows) - 30);
  const before = e.sun; e.collect(token.uid); e.collect(token.uid);
  expect(e.sun).toBe(before + 25);
  expect(e.effects.find(f => f.type === "fly")).toMatchObject({ screenX: pose.x, screenY: pose.y });
});
it("暂停时阳光位置与天气进度不动，过期资源不可收集", () => {
  const e = new Engine(8, []); e.token(3, 3, 5, true);
  const token = e.tokens[0]; token.age = 15.5; const before = tokenPose(token, 5);
  e.paused = true; run(e, 3); expect(tokenPose(token, 5)).toEqual(before);
  e.paused = false; run(e, 1); e.collect(token.uid); expect(e.coins).toBe(0);
});
it("猫尾草只能移到带活睡莲的水格，移动不重建单位", () => {
  const e = new Engine(21, []); e.addPlant("lily", 2, 0);
  const p = e.addPlant("cattail", 2, 0); p.hp = 123; p.timer = 4;
  e.selectTool(); e.useTool(2, 0);
  expect(e.useTool(0, 1)).toBe(false); expect(e.useTool(3, 1)).toBe(false);
  const base = e.addPlant("lily", 3, 1); base.hp = 0;
  expect(e.useTool(3, 1)).toBe(false); base.hp = 100;
  expect(e.useTool(3, 1)).toBe(true);
  expect(p).toMatchObject({ row: 3, col: 1, hp: 123, timer: 4 });
  expect(e.at(2, 0, "base")?.id).toBe("lily"); expect(e.toolUses).toBe(2);
});
