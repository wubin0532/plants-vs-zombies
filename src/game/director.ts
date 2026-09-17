import { plantById } from "./content";
import type { Plant, Zombie } from "./engine";
/** Defense score per lane: plant dps + wall hp + control bonuses - enemy hp. */
export function laneStrength(
  plants: Plant[],
  zombies: Zombie[],
  row: number,
  /** 困难模式把“这一行还有割草机”也算作防线强度，优先集火没有后手的那一行。 */
  mower = false,
) {
  let score = 0;
  for (const p of plants) {
    if (p.row !== row || p.hp <= 0) continue;
    const d = plantById[p.id];
    if (!p.sleep && d.damage && d.interval) score += d.damage / d.interval;
    if (d.kind === "wall" || d.kind === "armor") score += p.hp / 400;
    if (!p.sleep && ["snowpea", "winter"].includes(p.id)) score += 6;
    if (!p.sleep && d.kind === "spike") score += 8;
  }
  for (const z of zombies)
    if (z.row === row && !z.ally && z.hp > 0) score -= (z.hp + z.armor) / 300;
  if (mower) score += 8;
  return score;
}
/** Weak-lane/strong-lane pick probabilities; halved tilt for beginners. */
export function tiltFor(
  levelId: number,
  difficulty: string,
): [weak: number, strong: number] {
  return levelId <= 3 || difficulty === "casual" ? [0.3, 0.05] : [0.6, 0.1];
}
/** Director point cost per unit, roughly hp/armor/speed scaled. */
export const unitPrice: Record<string, number> = {
  basic: 1,
  flag: 1,
  cone: 2,
  paper: 2,
  pole: 2,
  backup: 2,
  ducky: 2,
  snorkel: 2,
  dolphin: 2,
  imp: 2,
  bucket: 3,
  screen: 3,
  digger: 3,
  pogo: 3,
  jack: 3,
  ladder: 3,
  balloon: 3,
  bungee: 3,
  bobsled: 3,
  football: 4,
  zomboni: 4,
  dancer: 4,
  catapult: 4,
  yeti: 4,
  garg: 6,
};
