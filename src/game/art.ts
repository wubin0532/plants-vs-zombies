const base = import.meta.env.BASE_URL;
export const plantImage = (id: string) => `${base}assets/portraits/p-${id}.${id === "arc" ? "svg" : "webp"}`;
export const zombieImage = (id: string) =>
  `${base}assets/portraits/z-${id}.webp`;
export const effectImage = (frame: number) =>
  `${base}assets/fx/fx-${frame}.webp`;
export const gardenImage = (scene = "day") =>
  `${base}assets/backgrounds/${scene}.webp`;

/** 云雾贴图：AI 出图直接覆盖同名文件即可，无需改代码。 */
export const mistImage = (id: "mist-a" | "mist-b" | "mist-c" | "glow-lantern") =>
  `${base}assets/mist/${id}.webp`;

/** 道具类贴图（小推车、地形、水面、token）：AI 出图直接覆盖同名文件。 */
export const mowerImage = () => `${base}assets/mower.png`;
export type TerrainKind = "grave" | "vase" | "ice" | "crater";
export const terrainImage = (kind: TerrainKind) => `${base}assets/terrain/${kind}.webp`;
export const waterImage = (kind: "water-strip" | "water-ripple") =>
  `${base}assets/water/${kind}.webp`;
export const tokenImage = (kind: "token-sun" | "token-coin") =>
  `${base}assets/tokens/${kind}.webp`;

export const bowlImage = (element: "ice" | "electric") => `${base}assets/portraits/b-${element}.svg`;
