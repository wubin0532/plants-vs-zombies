/** Visual proportions do not change tile occupancy or combat range. */
import { spriteScaleCorrection } from "./sprite-scale.generated";

const plants: Record<string, number> = {
  chomper: 1.35,
  squash: 1.18,
  tallnut: 1.2,
  cob: 1.45,
  doom: 1.2,
  melon: 1.12,
  winter: 1.15,
  cattail: 1.12,
};
const zombies: Record<string, number> = {
  garg: 1.65,
  pole: 1.2,
  football: 1.22,
  ladder: 1.15,
  dancer: 1.12,
  balloon: 1.12,
  zomboni: 1.3,
  catapult: 1.3,
  bobsled: 1.25,
  imp: 0.67,
};
/**
 * 这些僵尸的战斗形象来自动作图集（walk-*.webp），与立绘裁切无关，
 * 因此不能套用立绘的显示补偿，否则会平白改变它们的大小。
 */
const sheetZombies = new Set(["basic", "cone", "bucket", "garg", "pole"]);
const fix = (key: string, fromSheet: boolean) =>
  fromSheet ? 1 : (spriteScaleCorrection[key] ?? 1);

export const plantScale = (id: string) => (plants[id] ?? 1) * fix("p-" + id, false);
export const zombieScale = (id: string) =>
  (zombies[id] ?? 1) * fix("z-" + id, sheetZombies.has(id));
