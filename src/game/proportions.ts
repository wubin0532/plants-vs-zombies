/** Visual proportions do not change tile occupancy or combat range. */
import { spriteScaleCorrection } from "./sprite-scale.generated";
import { isMotionPlant, isMotionZombie } from "./animation";

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

/**
 * 花盆是「容器」而不是植物：按植物尺寸（86）画会让盆口卡在植物腰上。
 * 这里给它单独的显示边长，并把盆栽植物抬高到盆口土面上。
 */
export const POT_DISPLAY_SIZE = 60;
/** 动作图集统一贴底到 frameHeight-7。 */
const SHEET_BOTTOM_FRAME_Y = 248;
/** 花盆盆口土面在 256 帧中的 y（量自 public/assets/animation/pot.webp 帧 0）。 */
const POT_SOIL_FRAME_Y = 70;
/** 盆栽植物的抬高质量：让脚底正好落在盆口土面上。 */
export const POT_LIFT =
  ((SHEET_BOTTOM_FRAME_Y - POT_SOIL_FRAME_Y) * POT_DISPLAY_SIZE) / 256;
/** 立绘显示边长（256 帧 → 屏幕像素）：花盆按容器尺寸，其余按植物尺寸。 */
export const plantDisplaySize = (id: string) =>
  id === "pot" ? POT_DISPLAY_SIZE : 86;
export const plantScale = (id: string) =>
  (plants[id] ?? 1) * fix("p-" + id, isMotionPlant(id));
export const zombieScale = (id: string) =>
  (zombies[id] ?? 1) *
  fix("z-" + id, sheetZombies.has(id) || isMotionZombie(id));
