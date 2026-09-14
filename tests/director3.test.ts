import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { unitPrice } from "../src/game/director";

function totalPrice(e: Engine) {
  let total = 0;
  for (let w = 1; w <= e.totalWaves; w++)
    total += e.composeWave(w).reduce((s, id) => s + unitPrice[id], 0);
  return total;
}
it("受挫减档：丢车或损失植物降低预算，下限 0.6", () => {
  const base = totalPrice(new Engine(8, [], 42));
  const mowed = new Engine(8, [], 42);
  mowed.mowersLost = 1;
  expect(totalPrice(mowed)).toBeLessThan(base);
  const beaten = new Engine(8, [], 42);
  beaten.plantsLost = 6;
  expect(totalPrice(beaten)).toBeLessThan(base);
  const both = new Engine(8, [], 42);
  both.mowersLost = 2;
  both.plantsLost = 9;
  const bothTotal = totalPrice(both);
  expect(bothTotal).toBeLessThan(totalPrice(mowed));
  const slots = new Engine(8, [], 42).schedule.length;
  expect(bothTotal).toBeGreaterThanOrEqual(Math.floor(slots * 0.6));
});
it("碾压加档：阳光充裕且无丢车时预算上调", () => {
  const base = totalPrice(new Engine(8, [], 42));
  const rich = new Engine(8, [], 42);
  rich.sun = 700;
  expect(totalPrice(rich)).toBeGreaterThan(base);
  const broke = new Engine(8, [], 42);
  broke.sun = 700;
  broke.mowersLost = 1;
  const bothTotal = totalPrice(broke);
  expect(bothTotal).toBeLessThanOrEqual(base);
});
it("新手保护：前三关与 casual 不受减档", () => {
  const novice = new Engine(1, [], 42);
  novice.mowersLost = 2;
  novice.plantsLost = 9;
  expect(totalPrice(novice)).toBe(totalPrice(new Engine(1, [], 42)));
  const casual = new Engine(8, [], 42, { difficulty: "casual" });
  casual.mowersLost = 2;
  casual.plantsLost = 9;
  expect(totalPrice(casual)).toBe(
    totalPrice(new Engine(8, [], 42, { difficulty: "casual" })),
  );
});
it("总攻预告：旗波前 4 秒发出主攻行警报", () => {
  const e = new Engine(8, [], 42);
  e.addPlant("pea", 0, 1);
  const wave4At = e.schedule.find((s) => s.wave === 4)!.at;
  let firedAt = 0;
  for (let i = 0; i < 4000 && !firedAt; i++) {
    e.step(0.05);
    if (e.message.includes("主力瞄准")) firedAt = e.time;
  }
  expect(firedAt).toBeGreaterThan(0);
  expect(firedAt).toBeCloseTo(wave4At - 4, 0);
  expect(firedAt).toBeLessThan(wave4At);
  expect(e.message).toMatch(/僵尸主力瞄准了第 [1-5] 行！/);
  expect(e.messageTone).toBe("alert");
});
it("新手关卡不发总攻预告", () => {
  const e = new Engine(1, [], 42);
  e.composeWave(3);
  expect(e.assaultAlert).toBeNull();
});
it("同种子预告与阵容一致", () => {
  const run = () => {
    const e = new Engine(8, [], 42);
    e.addPlant("pea", 0, 1);
    const plans = [];
    for (let w = 1; w <= 5; w++) plans.push(e.composeWave(w).join(","));
    return plans.join("|") + "@" + JSON.stringify(e.assaultAlert);
  };
  expect(run()).toBe(run());
});
