const base = import.meta.env.BASE_URL;
export const plantImage = (id: string) => `${base}assets/portraits/p-${id}.png`;
export const zombieImage = (id: string) =>
  `${base}assets/portraits/z-${id}.png`;
export const effectImage = (frame: number) =>
  `${base}assets/fx/fx-${frame}.png`;
export const gardenImage = (scene = "day") =>
  `${base}assets/backgrounds/${scene}.png`;
