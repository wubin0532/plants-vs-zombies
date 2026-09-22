import type { Engine, Plant } from './engine';

export type FogState = Pick<Engine, 'level' | 'time' | 'fogClear' | 'plants'>;
export const lanternsIn = (e: FogState) => e.plants.filter(p => p.id === 'lantern' && p.hp > 0 && !p.sleep);
export const torchesIn = (e: FogState) => e.plants.filter(p => p.id === 'torch' && p.hp > 0 && !p.sleep);
export function fogActive(e: FogState) {
  // 风暴关每 8 秒闪电揭露 1 秒；窗口偏移到 7-8 秒，保证开局不是散雾状态。
  return e.level.scene === 'fog' && e.level.mode !== 'vases' && e.fogClear <= 0 &&
    !(e.level.mode === 'storm' && (e.time + 1) % 8 < 1);
}
/**
 * After card selection the mist creeps in from the right edge (col 9) and
 * settles at FOG_FINAL_FRONT, pale at its left edge and dense on the right.
 * Shared by the renderer and the zombie visibility check so both agree.
 *
 * 14 秒铺满：原来 25 秒时玩家在前半分钟几乎感觉不到「雾在推进」，而僵尸早已走到
 * 前线，观感更像「画面变灰」而不是「雾压过来」。14 秒既看得出过程，又能在第一波
 * 接战前成形。
 */
export const FOG_SPREAD_SECONDS = 14;
export const FOG_FINAL_FRONT = 3.15;
export function fogFront(e: FogState) {
  const progress = Math.min(1, Math.max(0, e.time / FOG_SPREAD_SECONDS));
  // Snap to the exact final front so the visibility boundary stays precise.
  return progress >= 1 ? FOG_FINAL_FRONT : 9 - (9 - FOG_FINAL_FRONT) * progress;
}
export function litCell(lights: Pick<Plant, 'row' | 'col'>[], row: number, col: number) {
  return lights.some(p => Math.abs(p.col - col) <= 2 && Math.abs(p.row - row) <= 1);
}
/**
 * Coordinates use cell centres, shared by sprites and the static visibility mask.
 * Callers that already have the light lists (the renderer) pass them in so this
 * hot path does not re-filter every plant once per zombie and frame.
 */
export function foggedAt(
  e: FogState,
  row: number,
  x: number,
  lights = lanternsIn(e),
  torches = torchesIn(e),
) {
  if (!fogActive(e) || x < fogFront(e) + .35 - 1e-9) return false;
  const c = Math.floor(x + .5), r = Math.floor(row + .5);
  if (litCell(lights, r, c)) return false;
  return !torches.some(p => Math.abs(p.col - c) <= 1 && Math.abs(p.row - r) <= 1);
}
