import type Phaser from "phaser";
import { BOARD } from "./layout";
import { tokenPose, weatherOpacity, WIND_DURATION, RAIN_DURATION } from "./ambient";
import type { Token } from "./engine";

export function drawWeather(g: Phaser.GameObjects.Graphics, time: number, windUntil: number, rainUntil: number, quality: string) {
  g.clear();
  const cold = weatherOpacity(time, windUntil, WIND_DURATION);
  const rain = weatherOpacity(time, rainUntil, RAIN_DURATION);
  if (!cold && !rain) return;
  const width = BOARD.cell * BOARD.cols;
  const count = quality === "low" ? 18 : quality === "medium" ? 32 : 48;
  if (cold) {
    g.fillStyle(0xc2ecf8, 0.10 * cold);
    g.fillRect(BOARD.left, BOARD.top, width, BOARD.lawnHeight);
    // Gentle mist ribbons and branching snowflakes, with no gameplay RNG calls.
    for (let i = 0; i < 3; i++) {
      const y = BOARD.top + 70 + i * 150 + Math.sin(time * 0.8 + i) * 18;
      g.fillStyle(0xe0f8ff, cold * 0.035);
      g.fillEllipse(BOARD.left + width / 2 + Math.sin(time + i) * 35, y, width, 80);
    }
    for (let i = 0; i < count; i++) {
      const x = BOARD.left + ((time * (55 + i % 5 * 10) + i * 137) % width);
      const y = BOARD.top + ((i * 71 + time * 25) % BOARD.lawnHeight);
      const size = 2 + i % 4;
      g.lineStyle(1, 0xf2ffff, cold * (0.35 + i % 3 * 0.15));
      if (i % 3) g.lineBetween(x, y, Math.max(BOARD.left, x - 14), y + 4);
      else for (let ray = 0; ray < 3; ray++) {
        const a = ray * Math.PI / 3 + time * 0.2;
        g.lineBetween(x - Math.cos(a) * size, y - Math.sin(a) * size, x + Math.cos(a) * size, y + Math.sin(a) * size);
      }
    }
  }
  if (rain) {
    g.fillStyle(0xffdc79, rain * 0.07);
    g.fillRect(BOARD.left, BOARD.top, width, BOARD.lawnHeight);
    for (let i = 0; i < count; i++) {
      const x = BOARD.left + ((i * 131 + time * 14) % width);
      const y = BOARD.top + ((time * (78 + i % 4 * 20) + i * 89) % BOARD.lawnHeight);
      g.lineStyle(2, 0xffecaa, rain * 0.40);
      g.lineBetween(x, y, x - 3, y - 11);
      if (i % 4 === 0) {
        g.fillStyle(0xfff7cf, rain * (0.25 + Math.sin(time * 3 + i) * 0.2));
        g.fillCircle(x, y, 3);
      }
    }
  }
}

export function drawToken(g: Phaser.GameObjects.Graphics, token: Token, rows: number, time: number, cold: number) {
  const { x, y, scale, alpha, turn } = tokenPose(token, rows);
  const pulse = 0.5 + Math.sin(time * 4 + token.uid) * 0.5;
  g.fillStyle(token.coin ? 0xeac366 : 0xffd95c, 0.14 * alpha);
  g.fillCircle(x, y, (token.coin ? 23 : 30 + pulse * 3) * scale);
  if (token.coin) {
    const width = 30 * turn * scale;
    g.fillStyle(0x9c6728, alpha);
    g.fillEllipse(x + 2, y + 2, width, 31 * scale);
    g.fillStyle(0xeac05c, alpha);
    g.fillEllipse(x, y, width, 30 * scale);
    g.lineStyle(2, 0xffe7a5, alpha);
    g.strokeEllipse(x, y, Math.max(2, width - 5), 25 * scale);
    g.lineStyle(2, 0x99702f, alpha * turn);
    g.strokeRect(x - 3 * turn, y - 4, 6 * turn, 8);
    g.fillStyle(0xfff9d4, alpha * (0.35 + pulse * 0.65));
    g.fillEllipse(x - 5 * turn, y - 7, 4 * turn, 6);
  } else {
    g.lineStyle(3, 0xf9c24f, alpha);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + time * 0.3;
      const r = (24 + pulse * 3) * scale;
      g.lineBetween(x + Math.cos(a) * r, y + Math.sin(a) * r,
        x + Math.cos(a) * (r + 5 * scale), y + Math.sin(a) * (r + 5 * scale));
    }
    g.fillStyle(0xffe18a, alpha);
    g.fillCircle(x, y, 20 * scale);
    g.lineStyle(2, 0xf6bc48, alpha);
    g.strokeCircle(x, y, 18 * scale);
    g.fillStyle(0xfff6c7, alpha * 0.8);
    g.fillEllipse(x - 6 * scale, y - 7 * scale, 11 * scale, 6 * scale);
  }
  if (cold) {
    g.lineStyle(1.5, 0xe2faff, cold * alpha * (0.2 + pulse * 0.3));
    g.strokeCircle(x, y, (token.coin ? 22 : 33) * scale);
  }
}
