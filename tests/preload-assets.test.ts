import { describe, expect, it, vi } from "vitest";

// scene-class.ts 在模块作用域继承 Phaser.Scene；这里被测的预加载规划函数
// 不触碰渲染器，所以先桩掉 Phaser 再导入，避免 node 环境下加载真引擎。
vi.mock("phaser", () => ({ default: { Scene: class {} } }));

import {
  hasZombieSheet,
  requiredPlantIds,
  requiredZombieIds,
  requiredZombiePortraits,
} from "../src/game/scene-class";
import { Engine } from "../src/game/engine";
import { levels, plantById, plants, zombieById } from "../src/game/content";
import { isMotionPlant } from "../src/game/animation";

/**
 * 从 engine.ts 的真实行为反推每关“可能出现”的集合，作为预加载覆盖率的参照。
 * 这里刻意不复用 scene-class 的 helper，这样以后 engine 新增刷怪/发卡来源而
 * 忘记同步预加载时，本测试会失败。
 */
function reachableZombies(levelId: number): Set<string> {
  const level = levels[levelId - 1];
  const ids = new Set<string>(level.enemies);
  ids.add("flag"); // 旗波会把首格替换成旗帜僵尸
  const engine = new Engine(levelId, []);

  if (level.mode === "boss") {
    // 僵王每隔一段时间召唤 basic/cone/bucket。
    for (let i = 0; i < 12; i++) {
      engine.bossTimer = 0;
      engine.updateBoss(0.1);
    }
    for (const z of engine.zombies) ids.add(z.id);
  }
  if (level.scene === "night") {
    // 让引擎跑完一波，触发夜里从墓碑爬出的僵尸。
    engine.schedule = [{ at: 0, id: "flag", wave: 1 }];
    engine.spawned = 0;
    engine.step(0.1);
    for (const z of engine.zombies) ids.add(z.id);
  }
  if (level.mode === "vases") {
    // 敲开所有罐子，收集随机开出的僵尸。
    for (let seed = 1; seed <= 60; seed++) {
      const e = new Engine(levelId, [], seed);
      for (const tile of e.tiles.filter((t) => t.type === "vase"))
        e.click(tile.row, tile.col);
      for (const z of e.zombies) ids.add(z.id);
    }
  }
  // 引擎里硬编码的召唤：舞王 -> 伴舞，巨人 -> 小鬼。
  if (ids.has("dancer")) ids.add("backup");
  if (ids.has("garg")) ids.add("imp");
  return ids;
}

/** 引擎实际会发到传送带/罐子/屋顶上的植物（卡池为空，逼出脚本来源）。 */
function reachablePlants(levelId: number): { ids: Set<string>; imitate: string } {
  const level = levels[levelId - 1];
  const ids = new Set<string>();
  const engine = new Engine(levelId, []);
  // 屋顶开局预种一排花盆。
  for (const p of engine.plants) ids.add(p.id);
  // 传送带卡池：多抽几次覆盖屋顶/水路的随机分支。
  if (["conveyor", "storm", "bowling", "boss"].includes(level.mode)) {
    for (let i = 0; i < 400; i++) {
      engine.conveyor = [];
      engine.addBelt();
      for (const id of engine.conveyor) ids.add(id);
    }
  }
  if (level.mode === "vases") {
    for (let seed = 1; seed <= 60; seed++) {
      const e = new Engine(levelId, [], seed);
      for (const tile of e.tiles.filter((t) => t.type === "vase"))
        e.click(tile.row, tile.col);
      for (const id of e.conveyor) ids.add(id);
    }
    // 两个密封奖励罐固定给 snowpea/arc。
    for (const id of ["snowpea", "arc"]) ids.add(id);
  }
  return { ids, imitate: engine.imitate };
}

describe("战斗预加载：只加载本局可能出现的资源", () => {
  it("为全部 50 关覆盖引擎能刷出的僵尸", () => {
    for (const level of levels) {
      const required = requiredZombieIds(level);
      const reachable = reachableZombies(level.id);
      for (const id of reachable) {
        expect(zombieById[id], `${level.label} 未登记僵尸 ${id}`).toBeTruthy();
        expect(required.has(id), `${level.label} 漏载僵尸 ${id}`).toBe(true);
      }
      expect(required.has("flag"), `${level.label} 缺少旗帜僵尸`).toBe(true);
      // 通关重玩可能混入雪人：普通关必须保守地包含它。
      if (level.mode === "normal")
        expect(required.has("yeti"), `${level.label} 缺少雪人僵尸`).toBe(true);
    }
  });

  it("为全部 50 关覆盖引擎能发放/种下的植物", () => {
    for (const level of levels) {
      const { ids, imitate } = reachablePlants(level.id);
      const required = requiredPlantIds(level, [], imitate);
      for (const id of ids) {
        expect(plantById[id], `${level.label} 未登记植物 ${id}`).toBeTruthy();
        expect(required.has(id), `${level.label} 漏载植物 ${id}`).toBe(true);
      }
      if (level.scene === "roof")
        expect(required.has("pot"), `${level.label} 缺少花盆`).toBe(true);
    }
  });

  it("把选定卡池、升级链和模仿者目标算进必载集合", () => {
    const cards = ["repeater", "sunflower", "kernel", "imitater"];
    const required = requiredPlantIds(levels[0], cards, "chomper");
    for (const id of cards) expect(required.has(id)).toBe(true);
    expect(required.has("gatling")).toBe(true); // repeater -> 机枪射手
    expect(required.has("twin")).toBe(true); // sunflower -> 双子向日葵
    expect(required.has("cob")).toBe(true); // kernel -> 玉米加农炮
    expect(required.has("chomper")).toBe(true); // 模仿者目标
  });

  it("每个必载僵尸都能解析到动作图集或立绘", () => {
    for (const level of levels) {
      const zombies = requiredZombieIds(level);
      const portraits = requiredZombiePortraits(level, zombies);
      for (const id of zombies) {
        const covered = hasZombieSheet(id) || portraits.has(id);
        expect(covered, `${level.label} 僵尸 ${id} 无贴图`).toBe(true);
      }
    }
  });

  it("每个必载植物都有动作图集（无动作图的才回退立绘）", () => {
    for (const level of levels) {
      const plantIds = requiredPlantIds(level, plants.map((p) => p.id), "pea");
      for (const id of plantIds) {
        expect(plantById[id], `${level.label} 植物 ${id} 未登记`).toBeTruthy();
        // 目前 50 株植物全部有动作图集（chomper 用专属图集），立绘只服务
        // 拖拽预览/滚球；这条断言保证以后新增无图植物时会被发现。
        expect(
          isMotionPlant(id) || id === "chomper",
          `${level.label} 植物 ${id} 既没有动作图集也没有立绘 fallback`,
        ).toBe(true);
      }
    }
  });
});
