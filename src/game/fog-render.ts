import type Phaser from 'phaser';
import type { Engine } from './engine';
import { BOARD } from './layout';
import { fogActive, fogFront, lanternsIn, torchesIn } from './visibility';

/**
 * 迷雾渲染：美术云雾贴图层 + 程序化可见性遮罩。
 *
 * - 云雾质感来自 public/assets/mist/*.webp（可被 AI 出图替换，代码无需改动）
 * - 遮罩负责玩法：右浓左淡的蔓延、路灯花/火炬的照亮、棋盘边缘羽化
 * - 确定性哈希噪声只用于遮罩的低频起伏，不消耗游戏随机数
 */
const hash = (x: number, y: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

type Buffer = {
  data: ImageData;
  w: number;
  h: number;
  mask: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

/**
 * 遮罩重算的最小间隔（秒）。迷雾是慢变化，逐帧重算不可感知地浪费：
 * 低端最省，高画质也限制在 20fps；光源/画质变化会绕过间隔立即重算。
 */
export const fogRefreshInterval = (quality: string) =>
  quality === "low" ? 0.1 : quality === "medium" ? 0.066 : 0.05;

/** 云雾层：贴图、世界尺寸、滚动速度、不透明度 */
const LAYERS = [
  { key: 'mist-a', size: 820, speed: 9, alpha: 0.78 },
  { key: 'mist-b', size: 540, speed: -17, alpha: 0.32 },
  { key: 'mist-c', size: 1180, speed: 5.5, alpha: 0.24 },
];

export class FogRenderer {
  private texture: Phaser.Textures.CanvasTexture;
  private image: Phaser.GameObjects.Image;
  private textures: Phaser.Textures.TextureManager;
  private buffers: Record<string, Buffer> = {};
  private cloud = document.createElement('canvas');
  private key = '';
  private lastTime = -1;
  private lastRender = -Infinity;
  constructor(scene: Phaser.Scene) {
    this.textures = scene.textures;
    this.texture = scene.textures.createCanvas('mist-surface', 600, 345)!;
    this.image = scene.add.image(0, 0, 'mist-surface').setOrigin(0).setDisplaySize(1200, 690).setDepth(100);
    this.cloud.width = 600; this.cloud.height = 345;
  }
  private buffer(quality: string): Buffer {
    // 遮罩分辨率：低画质降到 96×55；放大时的双线性插值本身就是柔化。
    const w = quality === 'low' ? 96 : 150, h = quality === 'low' ? 55 : 86;
    const id = `${w}x${h}`;
    if (!this.buffers[id]) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const mask = document.createElement('canvas');
      mask.width = 600; mask.height = 345;
      this.buffers[id] = { data: ctx.createImageData(w, h), w, h, mask, ctx };
    }
    return this.buffers[id];
  }
  /** 按世界尺寸无缝平铺贴图，形成多层视差流动。 */
  private tile(
    g: CanvasRenderingContext2D,
    img: CanvasImageSource,
    size: number,
    ox: number,
    oy: number,
    alpha: number,
  ) {
    const h = size / 2;
    g.globalAlpha = alpha;
    for (let y = (oy % h) - h; y < 345; y += h)
      for (let x = (ox % size) - size; x < 600; x += size) g.drawImage(img, x, y, size, h);
    g.globalAlpha = 1;
  }
  update(e: Engine, quality: string) {
    const visible = fogActive(e);
    this.image.setVisible(visible);
    if (!visible) { this.lastTime = -1; this.key = ''; this.lastRender = -Infinity; return; }
    // 每帧只取一次光源列表，避免逐像素过滤数组。
    const lanterns = lanternsIn(e), torches = torchesIn(e);
    const key = `${e.level.rows}:${quality}:` +
      lanterns.map(p => `${p.row},${p.col}`).sort().join(';') + '|' +
      torches.map(p => `${p.row},${p.col}`).sort().join(';');
    const changed = key !== this.key;
    // 单一守卫：时间冻结（暂停）、光源与画质都没变时，既不重算也不上传贴图。
    if (!changed && e.time === this.lastTime) return;
    this.key = key;
    this.lastTime = e.time;
    // 帧级节流：纯时间推进按画质间隔重算（low 原有隔帧减半并入此间隔，更省）；
    // 光源或画质变化立即重算，照明反馈不延迟。
    if (!changed && e.time - this.lastRender < fogRefreshInterval(quality)) return;
    this.lastRender = e.time;
    const low = quality === 'low';

    const { data, w, h, mask, ctx } = this.buffer(quality);
    const t = e.time;
    const front = fogFront(e);
    const span = Math.max(1, 9 - front);
    const sx = 1200 / w, sy = 690 / h;
    const boardR = BOARD.left + BOARD.cell * 9, boardB = BOARD.top + BOARD.lawnHeight;
    const rowH = BOARD.lawnHeight / e.level.rows;
    const px = data.data;
    for (let y = 0; y < h; y++) {
      const gy = (y + .5) * sy;
      const row = (gy - BOARD.top) / rowH;
      const dy = Math.max(BOARD.top - gy, gy - boardB, 0);
      for (let x = 0; x < w; x++) {
        const gx = (x + .5) * sx;
        const dx = Math.max(BOARD.left - gx, gx - boardR, 0);
        const edge = 1 - smooth(clamp01(Math.max(dx, dy) / 24));
        const offset = (y * w + x) * 4;
        if (edge <= 0) { px[offset + 3] = 0; continue; }
        const col = (gx - BOARD.left) / BOARD.cell;
        // 蔓延前沿：越靠左越淡
        const spread = smooth(clamp01((col - front) / span));
        // 低频起伏让前沿与浓淡不是一条直线，且有缓慢的呼吸感
        const n = vnoise(gx * .006 + t * .035, gy * .006 - t * .022) * .65 +
          vnoise(gx * .017 - t * .05, gy * .017 + t * .03) * .35;
        const bank = smooth(clamp01((n - .42) / .5));
        const density = clamp01(.04 + spread * (.35 + .45 * bank) + spread * spread * .28 + (n - .5) * .14);
        let reveal = 0;
        for (const p of lanterns) {
          const d = Math.max(Math.abs(p.col - col) / 2.6, Math.abs(p.row - row) / 1.6);
          reveal = Math.max(reveal, Math.max(0, 1 - d));
        }
        for (const p of torches) {
          const d = Math.max(Math.abs(p.col - col) / 1.6, Math.abs(p.row - row) / 1.35);
          reveal = Math.max(reveal, Math.max(0, .75 * (1 - d)));
        }
        px[offset] = px[offset + 1] = px[offset + 2] = 255;
        px[offset + 3] = Math.round(255 * density * (1 - reveal) * edge);
      }
    }
    ctx.putImageData(data, 0, 0);

    // 1) 遮罩放大到整幅画布
    const mctx = mask.getContext('2d')!;
    mctx.clearRect(0, 0, 600, 345);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(ctx.canvas, 0, 0, 600, 345);

    // 2) 云雾层合成：冷色底 + 多层贴图滚动 + 冷灰罩色（保住棉絮质感又不发白）
    const g = this.cloud.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, 600, 345);
    g.fillStyle = 'rgba(134,160,164,.66)';
    g.fillRect(0, 0, 600, 345);
    const layers = low ? LAYERS.slice(0, 1) : LAYERS;
    for (const layer of layers) {
      const img = this.textures.get(layer.key)?.getSourceImage() as CanvasImageSource | undefined;
      if (!img) continue;
      const ox = t * layer.speed, oy = t * layer.speed * .35;
      this.tile(g, img, layer.size, ox, oy, layer.alpha);
    }
    // 冷灰罩色只作用在云体上，保留云层内部的明暗纹理
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(92,118,126,.3)';
    g.fillRect(0, 0, 600, 345);
    // 3) 用玩法遮罩裁剪云雾，再贴到最终纹理
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-over';

    const out = this.texture.context;
    out.imageSmoothingEnabled = true;
    out.clearRect(0, 0, 600, 345);
    out.drawImage(this.cloud, 0, 0);
    // 4) 暖光：路灯花的暖晕，火炬更小更弱
    out.globalCompositeOperation = 'lighter';
    const glow = this.textures.get('glow-lantern')?.getSourceImage() as CanvasImageSource | undefined;
    if (glow) {
      for (const p of lanterns) {
        out.globalAlpha = .5;
        out.drawImage(glow, (BOARD.left + (p.col + .5) * BOARD.cell) / 2 - 95, (BOARD.top + (p.row + .5) * rowH) / 2 - 95, 190, 190);
      }
      for (const p of torches) {
        out.globalAlpha = .3;
        out.drawImage(glow, (BOARD.left + (p.col + .5) * BOARD.cell) / 2 - 60, (BOARD.top + (p.row + .5) * rowH) / 2 - 60, 120, 120);
      }
      out.globalAlpha = 1;
    }
    out.globalCompositeOperation = 'source-over';
    this.texture.refresh();
  }
}
