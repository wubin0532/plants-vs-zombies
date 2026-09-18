import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * 卡片贴图 + 待机幅度表生成。
 *
 * 卡片：把每个植物战斗动作图（plantanim / chomper）的待机首帧裁成 160×160，
 * 供选卡、图鉴、种子栏与拖拽预览使用——卡片、拖拽预览与场上植物保持同一张美术。
 *
 * 待机幅度：统计待机帧的内容高度峰峰值（动作图原始像素），输出
 * src/game/idle-motion.generated.ts，运行时据此决定待机换帧速度：
 * 幅度小的可以稍快、幅度大的保持基准帧，避免整片草坪在非战斗时抖动。
 */
const plantIds =
  "pea sunflower cherry wallnut potato snowpea chomper repeater puff sunshroom fume grave hypno scaredy ice doom lily squash three kelp jalapeno spike torch tallnut sea lantern cactus blover split star pumpkin magnet cabbage pot kernel coffee garlic umbrella marigold melon gatling twin gloom cattail winter goldmagnet spikerock cob imitater arc".split(
    " ",
  );

// 动作图清单里的帧数；缺省按 16 帧（大嘴花固定 16 帧、待机 4 帧）。
let motionFrames = {};
try {
  const source = await readFile("src/game/motion-manifest.generated.ts", "utf8");
  const block = source.slice(source.indexOf("motionPlantFrames"));
  motionFrames = JSON.parse(block.slice(block.indexOf("{"), block.lastIndexOf("}") + 1));
} catch {
  // 首次生成时清单可能还不存在，全部按 16 帧处理。
}

async function frameHeight(sheet, frame) {
  const cell = await sharp(sheet)
    .extract({ left: (frame % 4) * 256, top: Math.floor(frame / 4) * 256, width: 256, height: 256 })
    .png()
    .toBuffer();
  const { data } = await sharp(cell).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minY = 1e9, maxY = -1;
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++)
      if (data[(y * 256 + x) * 4 + 3] > 32) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return maxY - minY + 1;
}

const W = 160, H = 160, PAD = 7;
await mkdir("public/assets/cards", { recursive: true });

const idleRanges = {};
for (const id of plantIds) {
  const source = `public/assets/animation/${id}.webp`;
  const count = motionFrames[id] ?? 16;
  const idleCount = id === "chomper" ? 4 : count <= 8 ? 4 : 8;

  const heights = [];
  for (let f = 0; f < idleCount; f++) heights.push(await frameHeight(source, f));
  idleRanges[id] = Math.max(...heights) - Math.min(...heights);

  const cell = await sharp(source)
    .extract({ left: 0, top: 0, width: 256, height: 256 })
    .png()
    .toBuffer();
  const trimmed = await sharp(cell).trim({ threshold: 18 }).png().toBuffer();
  const fitted = await sharp(trimmed)
    .resize(W - 14, H - 18, { fit: "inside" })
    .png()
    .toBuffer();
  const m = await sharp(fitted).metadata();
  await sharp({ create: { width: W, height: H, channels: 4, background: "#00000000" } })
    .composite([{ input: fitted, left: Math.round((W - m.width) / 2), top: H - m.height - PAD }])
    .webp({ quality: 84 })
    .toFile(`public/assets/cards/p-${id}.webp`);
}

await writeFile(
  "src/game/idle-motion.generated.ts",
  "/** 由 scripts/prepare-cards.mjs 生成，请勿手改。\n" +
    " * 各植物待机帧的内容高度峰峰值（动作图原始像素），用于决定待机换帧速度。\n" +
    " * 幅度越小越平滑、可以换得快一点；幅度大的保持基准帧，只做程序化呼吸。*/\n" +
    `export const plantIdleRange: Record<string, number> = ${JSON.stringify(idleRanges, null, 2)};\n`,
);
console.log(`卡片贴图：${plantIds.length} 张 → public/assets/cards/`);
console.log(`待机幅度表 → src/game/idle-motion.generated.ts`);
