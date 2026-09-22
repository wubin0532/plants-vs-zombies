import { describe, it, expect } from "vitest";
import { fogDensity } from "../src/game/fog-render";
import { fogFront, FOG_SPREAD_SECONDS, FOG_FINAL_FRONT } from "../src/game/visibility";
import { Engine } from "../src/game/engine";

const BOARD = { left: 216, cell: 96, top: 200 };
const ROWS = [0, 1, 2, 3, 4, 5];
const gx = (col: number) => BOARD.left + (col + 0.5) * BOARD.cell;
const gy = (row: number) => BOARD.top + (row + 0.5) * 96;
/** 用真实迷雾关（4-1 = 31）的状态，避免手写 Level 结构随关卡表漂移。 */
const state = (time: number) => {
  const e = new Engine(31, []);
  e.time = time;
  return e;
};
/** 该列在若干行上的平均浓度（摊平低频噪声的单点偏差）。 */
const avg = (col: number, time: number) =>
  ROWS.reduce(
    (sum, r) => sum + fogDensity(col, r, time, fogFront(state(time)), gy(r), gx(col)),
    0,
  ) / ROWS.length;
/** 肉眼开始明显看出"有雾"的浓度阈值。 */
const VISIBLE = 0.12;
const visualEdge = (time: number) => {
  for (let c = 0; c <= 9; c += 0.05) if (avg(c, time) >= VISIBLE) return c;
  return null;
};

describe("迷雾浓度曲线", () => {
  it("开局几乎不可见：蔓延刚开始时不该整片变灰", () => {
    // 逻辑前锋还在 8.5 右侧，可见边界必须也在最右侧，否则"从右往左"看不出来。
    const edge = visualEdge(0.5);
    expect(edge === null || edge >= 8.4).toBe(true);
    for (const col of [3, 4, 5, 6, 7]) expect(avg(col, 0.5)).toBeLessThan(VISIBLE);
  });

  it("铺满后左半场也有足够浓度（雾墙而不是蒙灰）", () => {
    const settled = FOG_SPREAD_SECONDS + 2;
    // 实测锚点（k=0.35 / band=3.2）：c4≈0.27 c5≈0.58 c6≈0.83 c9≈0.93。
    // 最靠近前锋的一列本来就该是薄雾，因此 c4 的阈值放低，但从 c5 起要求过半。
    expect(avg(4, settled)).toBeGreaterThan(0.22);
    expect(avg(5, settled)).toBeGreaterThan(0.5);
    expect(avg(6, settled)).toBeGreaterThan(0.75);
    expect(avg(9, settled)).toBeGreaterThan(0.88);
  });

  it("视觉边界不过度领先或落后逻辑前锋（避免与 foggedAt 判定错位）", () => {
    for (const time of [3, 7, FOG_SPREAD_SECONDS, FOG_SPREAD_SECONDS + 5]) {
      const edge = visualEdge(time);
      expect(edge, `t=${time} 应看得见雾`).not.toBeNull();
      const gap = (edge as number) - fogFront(state(time));
      // 允许半列出头的错位：再大就会出现"看着没雾却判成剪影"。
      expect(gap, `t=${time} 可见边界与前锋差 ${gap.toFixed(2)} 列`).toBeLessThanOrEqual(0.6);
    }
  });

  it("浓度单调向右递增，且不超过 1", () => {
    const settled = FOG_SPREAD_SECONDS + 2;
    let previous = -1;
    for (let c = FOG_FINAL_FRONT; c <= 9; c += 0.5) {
      const d = avg(c, settled);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      expect(d, `col ${c} 应比左侧更浓`).toBeGreaterThanOrEqual(previous - 0.02);
      previous = d;
    }
  });

  it("同一列的浓度不随行号剧烈变化（避免横向条纹）", () => {
    const settled = FOG_SPREAD_SECONDS + 2;
    const front = fogFront(state(settled));
    for (const col of [4, 5, 6, 7, 8]) {
      const values = ROWS.map((r) => fogDensity(col, r, settled, front, gy(r), gx(col)));
      expect(Math.max(...values) - Math.min(...values), `col ${col} 行间差异过大`).toBeLessThan(0.45);
    }
  });

  it("14 秒铺满：第一波接战前成形，且仍看得出推进过程", () => {
    expect(FOG_SPREAD_SECONDS).toBeLessThanOrEqual(16);
    expect(FOG_SPREAD_SECONDS).toBeGreaterThanOrEqual(10);
    // 中段必须处于"正在推进"的状态（前锋在两端之间）。
    const mid = fogFront(state(FOG_SPREAD_SECONDS / 2));
    expect(mid).toBeLessThan(9);
    expect(mid).toBeGreaterThan(FOG_FINAL_FRONT);
  });
});
