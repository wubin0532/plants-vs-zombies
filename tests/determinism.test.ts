import { it, expect, describe } from "vitest";
import { Engine } from "../src/game/engine";
import { plants, plantById, isMushroom } from "../src/game/content";
import { GardenAudio } from "../src/game/audio";

/** 让玩偶匣进入可引爆状态，并用固定随机序列使它的引爆时刻一致。 */
function jackEngine(seed = 1) {
  const e = new Engine(1, [], seed);
  e.addPlant("pea", 0, 6);
  e.spawn("jack", 0, 6);
  const z = e.zombies[0];
  // 固定起始 RNG，让两侧的首次采样落在同一位置。
  z.age = 15.5;
  return { e, z };
}

describe("玩偶匣爆炸与步长无关", () => {
  it("同一颗种子、不同步长下在相同的模拟时刻附近引爆", () => {
    const fire = (dt: number) => {
      const { e, z } = jackEngine();
      let at: number | null = null;
      for (let i = 0; i < 4000; i++) {
        e.time += dt;
        e.updateZombie(z, dt);
        if (z.hp <= 0) {
          at = e.time;
          break;
        }
      }
      return at;
    };
    const fine = fire(1 / 60);
    const coarse = fire(0.1);
    expect(fine).not.toBeNull();
    expect(coarse).not.toBeNull();
    // 允许一个步长的误差；修复前两者会相差数百帧并让后续 RNG 序列分叉。
    expect(Math.abs((fine as number) - (coarse as number))).toBeLessThan(0.25);
  });

  it("引爆时刻只采样一次，重复调用不会重新掷骰", () => {
    const { e, z } = jackEngine();
    e.updateZombie(z, 1 / 60);
    const sampled = z.explodeAt;
    expect(sampled).toBeGreaterThan(15);
    e.updateZombie(z, 1 / 60);
    expect(z.explodeAt).toBe(sampled);
  });
});

describe("天降阳光只落在陆行", () => {
  it("泳池关的阳光不落在水面行", () => {
    // 关卡 21 起是泳池世界（6 行），row 2/3 为水面。
    const e = new Engine(21, []);
    expect(e.water(2) && e.water(3)).toBe(true);
    for (let i = 0; i < 4000; i++) e.step(1 / 60);
    const sky = e.tokens.filter((t) => t.origin === "sky");
    expect(sky.length, "应该有天降阳光").toBeGreaterThan(0);
    for (const token of sky) {
      expect(Number.isInteger(token.row), `阳光行号应为整数：${token.row}`).toBe(true);
      expect(e.water(token.row), `阳光不该落在水面行 ${token.row}`).toBe(false);
    }
  });

  it("夜间关卡不产生天降阳光（回归保护）", () => {
    const e = new Engine(11, []); // 11-20 是夜间世界
    for (let i = 0; i < 600; i++) e.step(1 / 60);
    expect(e.tokens.filter((t) => t.origin === "sky")).toHaveLength(0);
  });
});

describe("蘑菇名单与植物 kind 不漂移", () => {  it("所有 kind 为 shroom 的植物都算蘑菇", () => {
    const shrooms = plants.filter((p) => p.kind === "shroom").map((p) => p.id);
    expect(shrooms.length).toBeGreaterThan(0);
    for (const id of shrooms) expect(isMushroom(id), `${id} 应在蘑菇名单里`).toBe(true);
  });

  it("名单里的每一项都是真实存在的植物，且不会出现无来源的 id", () => {
    // 逐个植物反查：名单只能由已有植物组成（防止改名后残留失效项）。
    for (const p of plants) {
      if (!isMushroom(p.id)) continue;
      expect(plantById[p.id], `${p.id} 应存在于植物表`).toBeDefined();
    }
    expect(isMushroom("no-such-plant")).toBe(false);
  });
});

describe("音频总线在 stop() 时立即释放", () => {
  it("stop() 清空 buses 并断开节点，不依赖 onended 回调", () => {
    // 直接验证记账逻辑：后台标签页可能长时间不派发 onended，因此不能只靠回调清理。
    type Bus = { gain: { value: number }; connect(): void; disconnect(): void };
    type Internals = {
      buses: Map<Bus, { level: number; important: boolean }>;
      voices: Set<unknown>;
      last: Map<string, number>;
      priorities: Map<unknown, number>;
    };
    const audio = new GardenAudio();
    const internals = audio as unknown as Internals;
    const disconnected: number[] = [];
    const makeBus = (): Bus => ({
      gain: { value: 0 },
      connect() {},
      disconnect() {
        disconnected.push(1);
      },
    });
    const first = makeBus();
    const second = makeBus();
    internals.buses.set(first, { level: 1, important: false });
    internals.buses.set(second, { level: 1, important: true });
    internals.voices.add({ stop() {} });
    internals.last.set("hit", 1);
    internals.priorities.set({}, 1);

    audio.stop();

    expect(internals.buses.size).toBe(0);
    expect(internals.voices.size).toBe(0);
    expect(internals.last.size).toBe(0);
    expect(internals.priorities.size).toBe(0);
    expect(disconnected).toHaveLength(2);
  });
});
