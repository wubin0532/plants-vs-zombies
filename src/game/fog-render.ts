import type Phaser from 'phaser';
import type { Engine } from './engine';
import { BOARD, cellX, cellY } from './layout';
import { fogActive, foggedAt, lanternsIn } from './visibility';

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
    if (changed) {
      this.key = key;
      const g = this.mask.getContext('2d')!;
      const data = g.createImageData(600, 345);
      const clear: { left: number; top: number; right: number; bottom: number }[] = [];
      const h = BOARD.lawnHeight / e.level.rows;
      for (let r = 0; r < e.level.rows; r++) for (let c = 0; c < 9; c++) {
        if (!foggedAt(e, r, c, lights)) clear.push({ left: cellX(c) - BOARD.cell / 2,
          right: cellX(c) + BOARD.cell / 2, top: cellY(r, e.level.rows) - h / 2,
          bottom: cellY(r, e.level.rows) + h / 2 });
      }
      for (let y = 0; y < 345; y++) for (let x = 0; x < 600; x++) {
        const px = x * 2 + 1, py = y * 2 + 1;
        if (px < BOARD.left || px > BOARD.left + BOARD.cell * 9 || py < BOARD.top || py > BOARD.top + BOARD.lawnHeight) continue;
        // Feather into the fog only: a revealed cell is always completely clear.
        let distance = Math.min(py - BOARD.top, BOARD.top + BOARD.lawnHeight - py, BOARD.left + BOARD.cell * 9 - px, 42);
        for (const rect of clear) distance = Math.min(distance, Math.hypot(
          Math.max(rect.left - px, 0, px - rect.right), Math.max(rect.top - py, 0, py - rect.bottom)));
        const offset = (y * 600 + x) * 4;
        data.data[offset] = data.data[offset + 1] = data.data[offset + 2] = 255;
        data.data[offset + 3] = Math.round(255 * Math.min(1, distance / 42));
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
