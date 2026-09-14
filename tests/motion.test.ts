import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { zombieFrame, zombieAppearance } from "../src/game/animation";
for (const id of ["cone", "bucket"]) {
  it(`${id} 护甲掉落保留步态与脚底锚点`, () => {
    const e = new Engine(1, []);
    e.spawn(id, 0, 6);
    const z = e.zombies[0];
    e.updateZombie(z, 0.4);
    const look = zombieAppearance(z),
      frame = zombieFrame(z),
      motion = z.motion,
      x = z.x;
    e.damage(z, z.armor);
    expect(zombieAppearance(z).texture).toBe("walk-basic");
    expect(zombieFrame(z)).toBe(frame);
    expect(z.motion).toBe(motion);
    expect(z.x).toBe(x);
    expect(zombieAppearance(z).origin).toBe(look.origin);
    expect(zombieAppearance(z).height).toBe(look.height);
    expect(e.effects.filter((f) => f.type === "break")).toHaveLength(1);
  });
  it(`${id} 啃咬从首帧开始，冻结后动作不继续`, () => {
    const e = new Engine(1, []);
    e.addPlant("wallnut", 0, 4);
    e.spawn(id, 0, 4.2);
    const z = e.zombies[0];
    z.age = 12.7;
    e.updateZombie(z, 0.1);
    expect(z.action).toBe("eat");
    expect(zombieFrame(z)).toBe(12);
    e.updateZombie(z, 0.2);
    const frame = zombieFrame(z),
      hp = e.plants[0].hp;
    z.freeze = 2;
    for (let i = 0; i < 10; i++) e.updateZombie(z, 0.1);
    expect(zombieFrame(z)).toBe(frame);
    expect(e.plants[0].hp).toBe(hp);
  });
}
it("减速使步态与移动距离一起减半", () => {
  const e = new Engine(1, []);
  e.spawn("cone", 0, 6);
  e.spawn("cone", 1, 6);
  e.zombies[1].slow = 10;
  for (const z of e.zombies) e.updateZombie(z, 0.5);
  expect(e.zombies[1].motion).toBeCloseTo(e.zombies[0].motion / 2);
  expect(6 - e.zombies[1].x).toBeCloseTo((6 - e.zombies[0].x) / 2);
});
