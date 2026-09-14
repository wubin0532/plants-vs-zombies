import { it, expect } from "vitest";
import { Engine } from "../src/game/engine";
import { tiltFor } from "../src/game/director";

function defended(e: Engine, rows: number[]) {
  for (const r of rows) {
    for (let c = 0; c < 4; c++) e.addPlant("pea", r, c);
    e.addPlant("wallnut", r, 5);
  }
}
// spawn() 即出怪循环的行选择路径；弹出僵尸以隔离植物防线的加权（僵尸压行另测）。
function directedRows(e: Engine, n: number) {
  const rows = Array(e.level.rows).fill(0);
  for (let i = 0; i < n; i++) {
    e.spawn("basic");
    rows[e.zombies.at(-1)!.row]++;
    e.zombies.pop();
  }
  return rows;
}
it("单侧重防时，弱行承受显著更多出怪", () => {
  const e = new Engine(6, [], 42);
  defended(e, [0, 1]);
  const rows = directedRows(e, 100);
  expect(rows[2] + rows[3] + rows[4]).toBeGreaterThanOrEqual(60);
  expect(rows[0] + rows[1]).toBeLessThanOrEqual(35);
});
it("均衡防御时，各行出怪大致均匀", () => {
  const e = new Engine(6, [], 42);
  defended(e, [0, 1, 2, 3, 4]);
  const rows = directedRows(e, 100);
  expect(Math.max(...rows)).toBeLessThanOrEqual(32);
  expect(Math.min(...rows)).toBeGreaterThanOrEqual(8);
});
it("新手保护：前三关与休闲难度倾斜减半", () => {
  expect(tiltFor(6, "standard")).toEqual([0.6, 0.1]);
  expect(tiltFor(6, "hard")).toEqual([0.6, 0.1]);
  expect(tiltFor(1, "standard")).toEqual([0.3, 0.05]);
  expect(tiltFor(6, "casual")).toEqual([0.3, 0.05]);
});
it("特殊模式不启用加权出怪", () => {
  const e = new Engine(5, ["wallnut"], 42); // 保龄球关
  defended(e, [0, 1]);
  const rows = directedRows(e, 100);
  expect(rows[0] + rows[1]).toBeGreaterThanOrEqual(30);
});
it("存活僵尸压低所在行评分，形成连续施压", () => {
  const e = new Engine(6, [], 42);
  defended(e, [0, 1, 2, 3, 4]);
  e.spawn("basic", 3);
  e.spawn("basic", 3);
  e.spawn("cone", 3);
  const rows = directedRows(e, 100);
  e.zombies.pop();
  expect(rows[3]).toBeGreaterThanOrEqual(25);
});
