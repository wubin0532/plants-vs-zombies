const base = import.meta.env.BASE_URL;
export const plantImage = (id: string) => `${base}assets/portraits/p-${id}.webp`;
export const zombieImage = (id: string) =>
  `${base}assets/portraits/z-${id}.webp`;
export const effectImage = (frame: number) =>
  `${base}assets/fx/fx-${frame}.webp`;
export const gardenImage = (scene = "day") =>
  `${base}assets/backgrounds/${scene}.webp`;
