import type { Zombie } from './engine';

export type ControlSource = 'iceSlow' | 'iceFreeze' | 'weatherSlow' | 'otherFreeze';
/** Keep non-ice control alive when an electric reaction consumes ice. */
export function applyControl(z: Zombie, source: ControlSource, seconds: number) {
  z[source] = Math.max(z[source] ?? 0, seconds);
  if (source === 'iceSlow' || source === 'weatherSlow') z.slow = Math.max(z.slow, seconds);
  else z.freeze = Math.max(z.freeze, seconds);
}
export function tickControls(z: Zombie, dt: number) {
  for (const key of ['iceSlow', 'iceFreeze', 'weatherSlow', 'otherFreeze'] as const)
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
export function electricTarget(z: Zombie) {
  return z.hp > 0 && !z.ally && !z.underground && !z.flying &&
    (z.id !== 'snorkel' || z.action === 'eat');
}
export function conductionTargets(origin: Zombie, enemies: Zombie[]) {
  return enemies.filter(z => z.uid !== origin.uid && electricTarget(z) &&
    Math.abs(z.x - origin.x) <= 2 && Math.abs(z.row - origin.row) <= 1)
    .sort((a, b) => Math.hypot(a.x - origin.x, a.row - origin.row) -
      Math.hypot(b.x - origin.x, b.row - origin.row) || a.uid - b.uid).slice(0, 3);
}
