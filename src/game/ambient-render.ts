import type Phaser from "phaser";
import { BOARD } from "./layout";
import { weatherOpacity, WIND_DURATION, RAIN_DURATION } from "./ambient";

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
