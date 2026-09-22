import { it, expect, describe } from "vitest";
import { Engine } from "../src/game/engine";
import { zombieAppearance, zombiePose, zombieMotionInto } from "../src/game/animation";
import { projectileVisual, projectileVisualFor } from "../src/game/presentation";

describe("渲染热路径不再逐帧分配", () => {
  it("弹丸视觉按弹种复用同一实例，且字段与原实现一致", () => {
    const a = projectileVisual({ type: "pea" });
    expect(projectileVisual({ type: "pea" })).toBe(a);
    // 默认值 + 表项覆盖的组合关系必须保持。
    expect(a).toMatchObject({ width: 25, height: 25, lob: false, spin: false, image: "pea" });
    const melon = projectileVisualFor("melon");
    expect(melon).toMatchObject({ lob: true, spin: true, image: "melon", width: 43 });
    // visualType 优先于 type（黄油由玉米粒发射）。
    expect(projectileVisual({ type: "kernel", visualType: "butter" }).image).toBe("butter");
    expect(projectileVisual({ type: "kernel" }).image).toBe("kernel");
    // 未知弹种回落到默认的豌豆外观。
    expect(projectileVisualFor("no-such-shot").image).toBe("pea");
    // 共享实例是冻结的，渲染层误写会立刻暴露而不是污染全局。
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("僵尸外观按 id 复用实例，护甲打碎后切换到普通外观", () => {
    const e = new Engine(1, []);
    e.spawn("cone", 0, 5);
    e.spawn("cone", 0, 6);
    const [withCone, broken] = e.zombies;
    const appearance = zombieAppearance(withCone);
    // 同 id 的僵尸共享同一份外观表项。
    expect(zombieAppearance(broken)).toBe(appearance);
    expect(appearance.texture).toBe("walk-cone");
    // 打碎路障后换回普通外观，且那一项也被缓存复用。
    broken.armor = 0;
    const plain = zombieAppearance(broken);
    expect(plain.texture).toBe("walk-basic");
    expect(zombieAppearance(broken)).toBe(plain);
    expect(plain).not.toBe(appearance);
  });

  it("zombieMotionInto 写入复用对象，不产生新对象；zombiePose 保持返回值语义", () => {
    const e = new Engine(1, []);
    e.spawn("dancer", 0, 5);
    const z = e.zombies[0];
    z.motion = 4;
    z.actionTime = 1;

    const scratch = { angle: 0, lift: 0 };
    const returned = zombieMotionInto(z, scratch);
    expect(returned).toBe(scratch);
    expect(scratch.angle).not.toBe(0);

    // 连续两帧继续复用同一个对象。
    z.motion = 8;
    expect(zombieMotionInto(z, scratch)).toBe(scratch);

    // 测试与外部调用依赖的「返回新对象」语义保持不变。
    const first = zombiePose(z);
    const second = zombiePose(z);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(first).toEqual({ angle: scratch.angle, lift: scratch.lift });
  });
});

describe("地块版本号", () => {
  it("地块 life 倒计时不让版本号变化", () => {
    // 关卡 11 开局就有墓碑地块；之后只跑时间、不增删地块，版本号必须稳定
    // （否则渲染层的地块缓存会被逐帧判为失效，等于没省）。
    const e = new Engine(11, []);
    expect(e.tilesVersion).toBeGreaterThan(0);
    const stable = e.tilesVersion;
    for (let i = 0; i < 300; i++) e.step(1 / 60);
    expect(e.tilesVersion).toBe(stable);
  });

  it("新增地块（毁灭菇弹坑）会递增版本号", () => {
    const e = new Engine(11, []);
    const before = e.tilesVersion;
    // 毁灭菇在夜间才会醒着，直接种下并推进到引爆。
    const doom = e.addPlant("doom", 0, 3);
    doom.timer = 0;
    for (let i = 0; i < 300 && !e.tiles.some((t) => t.type === "crater"); i++)
      e.step(1 / 60);
    expect(e.tiles.some((t) => t.type === "crater")).toBe(true);
    expect(e.tilesVersion).toBeGreaterThan(before);
  });
});
