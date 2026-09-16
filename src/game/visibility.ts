import type { Engine, Plant } from './engine';

export type FogState = Pick<Engine, 'level' | 'time' | 'fogClear' | 'plants'>;
export const lanternsIn = (e: FogState) => e.plants.filter(p => p.id === 'lantern' && p.hp > 0 && !p.sleep);
export const torchesIn = (e: FogState) => e.plants.filter(p => p.id === 'torch' && p.hp > 0 && !p.sleep);
export function fogActive(e: FogState) {
  return e.level.scene === 'fog' && e.level.mode !== 'vases' && e.fogClear <= 0 &&
    !(e.level.mode === 'storm' && e.time % 8 < 1);
}
export function litCell(lights: Pick<Plant, 'row' | 'col'>[], row: number, col: number) {
  return lights.some(p => Math.abs(p.col - col) <= 2 && Math.abs(p.row - row) <= 1);
}
export function lightFalloff(e: FogState, row: number, x: number) {
  let reveal = 0;
  for (const p of lanternsIn(e)) {
    const d = Math.max(Math.abs(p.col - x) / 2.6, Math.abs(p.row - row) / 1.6);
    reveal = Math.max(reveal, Math.max(0, 1 - d));
  }
  // Torchlight is deliberately smaller and softer than Lantern's permanent beam.
  for (const p of torchesIn(e)) {
    const d = Math.max(Math.abs(p.col - x) / 1.15, Math.abs(p.row - row) / 1.05);
    reveal = Math.max(reveal, Math.max(0, 0.55 * (1 - d)));
  }
  return reveal;
}
/** Coordinates use cell centres, shared by sprites and the static visibility mask. */
export function foggedAt(e: FogState, row: number, x: number, lights = lanternsIn(e)) {
  if (!fogActive(e) || x < 3.5) return false;
  const c = Math.floor(x + .5), r = Math.floor(row + .5);
  if (litCell(lights, r, c)) return false;
  return !torchesIn(e).some(p => Math.abs(p.col - c) <= 1 && Math.abs(p.row - r) <= 1);
}
