import type { Engine, Plant } from './engine';

export type FogState = Pick<Engine, 'level' | 'time' | 'fogClear' | 'plants'>;
export const lanternsIn = (e: FogState) => e.plants.filter(p => p.id === 'lantern' && p.hp > 0 && !p.sleep);
export function fogActive(e: FogState) {
  return e.level.scene === 'fog' && e.level.mode !== 'vases' && e.fogClear <= 0 &&
    !(e.level.mode === 'storm' && e.time % 8 < 1);
}
export function litCell(lights: Pick<Plant, 'row' | 'col'>[], row: number, col: number) {
  return lights.some(p => Math.abs(p.col - col) <= 2 && Math.abs(p.row - row) <= 1);
}
/** Coordinates use cell centres, shared by sprites and the static visibility mask. */
export function foggedAt(e: FogState, row: number, x: number, lights = lanternsIn(e)) {
  return fogActive(e) && x >= 3.5 &&
    !litCell(lights, Math.floor(row + .5), Math.floor(x + .5));
}
