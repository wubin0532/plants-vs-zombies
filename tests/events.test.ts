import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";

it("黄金僵尸死亡额外掉 100-200 金币 token", () => {
  const e = new Engine(1, []);
  e.spawn("basic", 0, 5);
  const z = e.zombies[0];
  z.golden = true;
  e.damage(z, 99999, true);
  e.step(0.1);
  const coin = e.tokens.find((t) => t.coin && t.value >= 100);
  expect(coin).toBeDefined();
  expect(coin!.value).toBeLessThanOrEqual(200);
});
it("普通僵尸不掉大额金币", () => {
  const e = new Engine(1, []);
  e.spawn("basic", 0, 5);
  e.damage(e.zombies[0], 99999, true);
  e.step(0.1);
  expect(e.tokens.every((t) => t.value < 100)).toBe(true);
});
it("终局慢镜头延迟结算，随后正常获胜", () => {
  const e = new Engine(1, []);
  e.spawned = e.level.count;
  e.step(0.1);
  expect(e.status).toBe("playing");
  expect(e.winDelay).toBeGreaterThan(0);
  for (let i = 0; i < 20 && e.status === "playing"; i++) e.step(0.1);
  expect(e.status).toBe("won");
});
it("场上还有敌人时不触发慢镜头", () => {
  const e = new Engine(1, []);
  e.spawned = e.level.count;
  e.spawn("basic", 0, 5);
  e.step(0.1);
  expect(e.status).toBe("playing");
  expect(e.winDelay).toBeLessThan(0);
});
it("最终波播放号角，普通大波不播放", () => {
  const e = new Engine(1, []);
  e.schedule = [{ at: e.time, wave: 1, id: "basic" }];
  e.step(0.1);
  expect(e.sounds.some((s) => s.kind === "horn")).toBe(true);
  const f = new Engine(1, []);
  f.schedule = [
    { at: f.time, wave: 1, id: "basic" },
    { at: f.time + 100, wave: 2, id: "basic" },
  ];
  f.step(0.1);
  expect(f.sounds.some((s) => s.kind === "horn")).toBe(false);
});
it("僵尸越过无小推车保护的中场时报警一次", () => {
  const e = new Engine(1, []);
  e.mowers[0] = false;
  e.spawn("basic", 0, 3.45);
  e.step(0.1);
  expect(e.message).toContain("防线告急");
  expect(e.sounds.some((s) => s.kind === "danger")).toBe(true);
  e.drainSounds();
  e.mowers[1] = false;
  e.spawn("basic", 1, 3.45);
  e.step(0.1);
  expect(e.sounds.some((s) => s.kind === "danger")).toBe(false);
});
it("有小推车保护的行不报警", () => {
  const e = new Engine(1, []);
  e.spawn("basic", 0, 3.45);
  e.step(0.1);
  expect(e.sounds.some((s) => s.kind === "danger")).toBe(false);
});

it("第 10 波起随机出现狂暴僵尸：生命护甲 +60%、移速 +30%", () => {
  const e = new Engine(1, []);
  e.schedule = Array.from({ length: 30 }, (_, i) => ({
    at: e.time + i * 0.05,
    wave: 12,
    id: "basic",
  }));
  for (let i = 0; i < 20 && e.zombies.length < 30; i++) e.step(0.1);
  const enraged = e.zombies.filter((z) => (z.boost ?? 1) > 1);
  expect(enraged.length).toBeGreaterThan(0);
  for (const z of enraged) {
    expect(z.max).toBeCloseTo(200 * 1.6);
    expect(z.boost).toBeCloseTo(1.3);
  }
  expect(e.message).toContain("狂暴僵尸");
});
it("第 7 波之前不会出现狂暴僵尸", () => {
  const e = new Engine(1, []);
  e.schedule = Array.from({ length: 30 }, (_, i) => ({
    at: e.time + i * 0.05,
    wave: 6,
    id: "basic",
  }));
  for (let i = 0; i < 20 && e.zombies.length < 30; i++) e.step(0.1);
  expect(e.zombies.every((z) => !z.boost)).toBe(true);
});
it("狂暴僵尸移动更快", () => {
  const e = new Engine(1, []);
  e.spawn("basic", 0, 5);
  e.spawn("basic", 1, 5);
  e.zombies[1].boost = 1.3;
  const [a, b] = e.zombies;
  e.step(0.1);
  expect(5 - b.x).toBeCloseTo((5 - a.x) * 1.3, 5);
});
it("alert 展示期间 info 排队，alert 到期后依次补播", () => {
  const e = new Engine(1, []);
  e.say("紧急警报", "alert");
  e.say("普通提示一");
  e.say("普通提示二");
  expect(e.message).toBe("紧急警报");
  for (let i = 0; i < 41; i++) e.step(0.1);
  expect(e.message).toBe("普通提示一");
  for (let i = 0; i < 41; i++) e.step(0.1);
  expect(e.message).toBe("普通提示二");
});
it("alert 可以顶掉 alert", () => {
  const e = new Engine(1, []);
  e.say("警报一", "alert");
  e.say("警报二", "alert");
  expect(e.message).toBe("警报二");
  expect(e.messageTone).toBe("alert");
});
