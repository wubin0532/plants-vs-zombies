import type { Zombie } from './engine';

export type ControlSource = 'iceSlow' | 'iceFreeze' | 'weatherSlow' | 'otherFreeze';
/** Keep non-ice control alive when an electric reaction consumes ice. */
export function applyControl(z: Zombie, source: ControlSource, seconds: number) {
  z[source] = Math.max(z[source] ?? 0, seconds);
  if (source === 'iceSlow' || source === 'weatherSlow') z.slow = Math.max(z.slow, seconds);
  else z.freeze = Math.max(z.freeze, seconds);
}
/** Hoisted so the per-zombie control tick allocates nothing. */
const CONTROL_KEYS = ['iceSlow', 'iceFreeze', 'weatherSlow', 'otherFreeze'] as const;
export function tickControls(z: Zombie, dt: number) {
  for (const key of CONTROL_KEYS)
    z[key] = Math.max(0, (z[key] ?? 0) - dt);
  z.slow = Math.max(0, z.slow - dt);
  z.freeze = Math.max(0, z.freeze - dt);
}
export function consumeIce(z: Zombie) {
  if (!(z.iceSlow! > 0 || z.iceFreeze! > 0)) return false;
  z.iceSlow = z.iceFreeze = 0;
  z.slow = z.weatherSlow ?? 0;
  z.freeze = z.otherFreeze ?? 0;
  return true;
}
/** Shared eligibility; attack families explicitly opt into air or submerged targets. */
export function attackTarget(z: Zombie, airborne = false, submerged = false) {
  return z.hp > 0 && !z.ally && !z.underground && (airborne || !z.flying) &&
    (submerged || z.id !== 'snorkel' || z.action === 'eat');
}
export const isLob = (type: string) => ['cabbage', 'kernel', 'butter', 'melon', 'winter'].includes(type);
export function projectileTarget(z: Zombie, type: string, aimedUnderwater = false) {
  return attackTarget(z, ['cactus', 'cattail'].includes(type),
    isLob(type) || type === 'cattail' || aimedUnderwater);
}
export function electricTarget(z: Zombie) {
  return attackTarget(z);
}
export function conductionTargets(origin: Zombie, enemies: Zombie[]) {
  // 传导只沿同一排（不再跨 ±1 排），与电击的走位一致，避免跨排 AoE 过强。
  return enemies.filter(z => z.uid !== origin.uid && electricTarget(z) &&
    z.row === origin.row && Math.abs(z.x - origin.x) <= 2)
    .sort((a, b) => Math.hypot(a.x - origin.x, a.row - origin.row) -
      Math.hypot(b.x - origin.x, b.row - origin.row) || a.uid - b.uid).slice(0, 3);
}
