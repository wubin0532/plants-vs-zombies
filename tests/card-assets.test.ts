import { it, expect } from "vitest";
import sharp from "sharp";
import { plants } from "../src/game/content";

/**
 * 卡片贴图契约：卡片必须来自战斗动作图的待机首帧（scripts/prepare-cards.mjs），
 * 这样选卡、图鉴、种子栏和拖拽预览与场上植物是同一张美术。
 */
async function contentBox(input: string | Uint8Array) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * info.channels + 3] > 32) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return { left: minX, top: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

for (const def of plants) {
  it(`卡片 p-${def.id} 存在、尺寸正确、取自战斗待机首帧`, async () => {
    const card = `public/assets/cards/p-${def.id}.webp`;
    const meta = await sharp(card).metadata();
    expect([meta.width, meta.height]).toEqual([160, 160]);
    expect(meta.hasAlpha).toBe(true);
    const box = await contentBox(card);
    expect(box.left).toBeGreaterThanOrEqual(4);
    expect(box.top).toBeGreaterThanOrEqual(4);
    expect(160 - (box.left + box.w)).toBeGreaterThanOrEqual(4);
    expect(160 - (box.top + box.h)).toBeGreaterThanOrEqual(4);
    // 卡片等比缩自战斗图首帧：内容宽高比必须与首帧一致，旧立绘会被这条拦住。
    const cell = await sharp(`public/assets/animation/${def.id}.webp`)
      .extract({ left: 0, top: 0, width: 256, height: 256 })
      .png()
      .toBuffer();
    const frameBox = await contentBox(await sharp(cell).trim({ threshold: 18 }).png().toBuffer());
    expect(Math.abs(box.w / box.h - frameBox.w / frameBox.h)).toBeLessThan(0.05);
  });
}
