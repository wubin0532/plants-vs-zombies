const base = import.meta.env.BASE_URL;
// 构建版本号：附加到所有素材 URL，保证重新构建后浏览器立即取新图，而不是命中
// 固定文件名的缓存（nginx 对 /assets/ 固定名素材给了 max-age=3600）。
const buildId = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
/** 给素材路径加构建版本查询串；已带查询串时用 & 追加。 */
export const assetUrl = (path: string) => {
  const url = base + path;
  return url + (url.includes("?") ? "&" : "?") + "v=" + buildId;
};

// 卡片统一取自战斗动作图的待机首帧（scripts/prepare-cards.mjs），
// 保证选卡/图鉴/拖拽预览与场上植物是同一张美术。
export const plantImage = (id: string) => assetUrl(`assets/cards/p-${id}.webp`);
export const zombieImage = (id: string) =>
  assetUrl(`assets/portraits/z-${id}.webp`);
export const effectImage = (frame: number) =>
  assetUrl(`assets/fx/fx-${frame}.webp`);
export const gardenImage = (scene = "day") =>
  assetUrl(`assets/backgrounds/${scene}.webp`);

/** 云雾贴图：AI 出图直接覆盖同名文件即可，无需改代码。 */
export const mistImage = (id: "mist-a" | "mist-b" | "mist-c" | "glow-lantern" | "overcast-cloud") =>
  assetUrl(`assets/mist/${id}.webp`);
/** 天气特效贴图（阴天雨幕），AI 出图直接覆盖同名文件，代码无需改动。 */
export const weatherImage = (kind: "rain-streak" | "rain-splash" | "water-splash" | "wind-leaves" | "icon-weather" | "heat-shimmer" | "cloud-shadow" | "frost" | "snow-tile" | "blackout-glow" | "sun-flare" | "eclipse-mask" | "water-caustics") =>
  assetUrl(`assets/weather/${kind}.webp`);
/** 泳池波纹帧：4 帧横向序列，每帧 512×128，可平铺。 */
export const waterFramesImage = () => assetUrl("assets/water/water-frames.webp");
/** 泳池底色帧：4 帧横向序列，每帧 891×168。 */
export const waterStripFramesImage = () => assetUrl("assets/water/water-strip-frames.webp");

/** 道具类贴图（小推车、地形、水面、token）：AI 出图直接覆盖同名文件。 */
export const mowerImage = () => assetUrl("assets/mower.png");
export type TerrainKind = "grave" | "vase" | "ice" | "crater";
export const terrainImage = (kind: TerrainKind) =>
  assetUrl(`assets/terrain/${kind}.webp`);
export const waterImage = (kind: "water-strip" | "water-ripple") =>
  assetUrl(`assets/water/${kind}.webp`);
export const tokenImage = (kind: "token-sun" | "token-coin") =>
  assetUrl(`assets/tokens/${kind}.webp`);

export const bowlImage = (element: "ice" | "electric") =>
  assetUrl(`assets/portraits/b-${element}.webp`);
/** 主页功能卡图标。 */
export const featureImage = (kind: "map" | "almanac" | "daily") =>
  assetUrl(`assets/icons/feature-${kind}.webp`);

/** UI 图标（AI 重绘，见 docs/ui-icon-prompts.md）：暂停菜单、工具、设置等。 */
export type UiIconName =
  | "resume"
  | "restart"
  | "home"
  | "shovel"
  | "transplant"
  | "settings"
  | "menu"
  | "sound-on"
  | "sound-off"
  | "exit-fullscreen"
  | "speed"
  | "pause"
  | "fullscreen";
export const uiIcon = (name: UiIconName) =>
  assetUrl(`assets/icons/ui-${name}.webp`);
/** 单色剪影图标：供 CSS mask 使用，可随按钮文字色自动变色。 */
export const uiIconMono = (
  name:
    | "resume"
    | "restart"
    | "home"
    | "shovel"
    | "transplant"
    | "settings"
    | "menu"
    | "sound-on"
    | "sound-off"
    | "exit-fullscreen"
    | "fullscreen"
    | "pause"
    | "speed",
) => assetUrl(`assets/icons/ui-${name}-mono.webp`);
