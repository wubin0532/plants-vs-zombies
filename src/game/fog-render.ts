import type Phaser from 'phaser';
import type { Engine } from './engine';
import { BOARD } from './layout';
import { fogActive, lanternsIn, lightFalloff } from './visibility';

/** Canvas compositing also works with Phaser's Canvas fallback (no WebGL-only mask). */
export class FogRenderer {
  private texture: Phaser.Textures.CanvasTexture;
  private image: Phaser.GameObjects.Image;
  private mask = document.createElement('canvas');
  private cloud = document.createElement('canvas');
  private key = '';
  private lastTime = -1;
  private quality = '';
  constructor(scene: Phaser.Scene) {
    this.texture = scene.textures.createCanvas('mist-surface', 600, 345)!;
    this.image = scene.add.image(0, 0, 'mist-surface').setOrigin(0).setDisplaySize(1200, 690).setDepth(100);
    this.mask.width = 600; this.mask.height = 345;
    this.cloud.width = 256; this.cloud.height = 256;
    const g = this.cloud.getContext('2d')!;
    // Periodic cloud tile, generated once without touching gameplay randomness.
    for (let i = 0; i < 7; i++) {
      const x = (i * 97) % 256, y = (i * 61) % 256;
      for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
        const gradient = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, 90);
        gradient.addColorStop(0, 'rgba(227,243,235,.36)');
        gradient.addColorStop(1, 'rgba(236,248,233,0)');
        g.fillStyle = gradient; g.fillRect(x + dx - 90, y + dy - 90, 180, 180);
      }
    }
  }
  update(e: Engine, quality: string) {
    const visible = fogActive(e);
    this.image.setVisible(visible);
    if (!visible) { this.lastTime = -1; return; }
    const lights = lanternsIn(e);
    const key = `${e.level.rows}:` + lights.map(p => `${p.row},${p.col}`).sort().join(';');
    const changed = key !== this.key;
    if (changed || e.time !== this.lastTime) {
      this.key = key;
      const g = this.mask.getContext('2d')!;
      const data = g.createImageData(600, 345);
      const h = BOARD.lawnHeight / e.level.rows;
      for (let y = 0; y < 345; y++) for (let x = 0; x < 600; x++) {
        const px = x * 2 + 1, py = y * 2 + 1;
        if (px < BOARD.left || px > BOARD.left + BOARD.cell * 9 || py < BOARD.top || py > BOARD.top + BOARD.lawnHeight) continue;
        const col = (px - BOARD.left) / BOARD.cell;
        const row = (py - BOARD.top) / h;
        // Mist advances from right to left. The first fogged column is pale,
        // while the far right is dense enough to hide silhouettes completely.
        const spread = Math.max(0, Math.min(1, (col - 3.15) / 5.85));
        const cloud =
          Math.sin(px * .047 + e.time * .42) * .11 +
          Math.sin(py * .071 - e.time * .28) * .09 +
          Math.sin((px + py) * .021 + e.time * .18) * .07;
        const density = Math.max(0, Math.min(1, .06 + spread * .76 + cloud));
        const reveal = lightFalloff(e, row, col);
        const alpha = density * (1 - reveal);
        const offset = (y * 600 + x) * 4;
        data.data[offset] = data.data[offset + 1] = data.data[offset + 2] = 255;
        data.data[offset + 3] = Math.round(255 * alpha);
      }
      g.putImageData(data, 0, 0);
    }
    // Pause does not upload a texture. Low quality removes a cloud layer, never lighting.
    if (!changed && quality === this.quality && e.time === this.lastTime) return;
    this.quality = quality; this.lastTime = e.time;
    const g = this.texture.context;
    g.clearRect(0, 0, 600, 345);
    g.fillStyle = 'rgba(143,172,172,.65)'; g.fillRect(0, 0, 600, 345);
    const layers = quality === 'low' ? 1 : 2;
    for (let layer = 0; layer < layers; layer++) {
      const dx = ((e.time * (layer ? -3 : 5)) % 256 + 256) % 256;
      const dy = (e.time * 1.5 + layer * 103) % 256;
      for (let y = -256; y < 345; y += 256) for (let x = -256; x < 600; x += 256)
        g.drawImage(this.cloud, x + dx, y + dy);
    }
    g.globalCompositeOperation = 'destination-in'; g.drawImage(this.mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
    this.texture.refresh();
  }
}
