import type { Token } from "./engine";
import { BOARD, cellX, cellY } from "./layout";

export const WIND_DURATION = 8;
export const RAIN_DURATION = 10;
export const TOKEN_LIFETIME = 16;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };

/** Simulation time keeps particles still while paused and deterministic at 2x. */
export function weatherOpacity(time: number, until: number, duration: number) {
  return smooth((time - (until - duration)) / 0.7) * smooth((until - time) / 1.2);
}

/** One pose is shared by drawing, pointer hit testing and the pickup animation. */
export function tokenPose(t: Token, rows: number) {
  const phase = t.age * 3 + t.uid;
  const settle = clamp(t.age / (t.origin === "sky" ? 1.8 : 0.65));
  const destinationY = cellY(t.row, rows);
  const lift = t.origin === "sky"
    ? (BOARD.top - 24 - destinationY) * (1 - smooth(settle))
    : -Math.sin(settle * Math.PI) * (t.coin ? 25 : 38);
  return {
    x: cellX(t.x) + (t.origin === "sky" ? Math.sin(settle * Math.PI) * 10 : 0),
    y: destinationY + lift + Math.sin(phase) * 3 * settle,
    scale: 0.65 + 0.35 * smooth(t.age / 0.22),
    alpha: smooth((TOKEN_LIFETIME - t.age) / 0.7) *
      (t.age > TOKEN_LIFETIME - 3 ? 0.65 + Math.cos(t.age * 10) * 0.35 : 1),
    turn: t.coin ? Math.max(0.18, Math.abs(Math.cos(t.age * 3 + t.uid))) : 1,
  };
}
