import type Phaser from "phaser";
import type { Zombie } from "./engine";
const vehicles = new Set(["zomboni", "bobsled", "catapult", "boss"]);
const floats = new Set(["ducky", "snorkel", "dolphin", "balloon", "bungee"]);
export function zombieFrame(z: Zombie) {
  return z.action === "eat"
    ? 8 + (Math.floor(z.age * 6) % 4)
    : Math.floor(z.motion / 3.8) % 8;
}
export function jumpHeight(z: Zombie) {
  return z.jump
    ? Math.sin((Math.PI * z.jump.elapsed) / z.jump.duration) * 46
    : 0;
}
/** Bake articulated walking/eating poses from the PNG torso and leg regions. */
export function bakeZombie(scene: Phaser.Scene, id: string) {
  const source = scene.textures
    .get("z-" + id)
    .getSourceImage() as HTMLImageElement;
  const atlas = scene.textures.createCanvas("anim-" + id, 640, 600)!;
  const ctx = atlas.context;
  for (let frame = 0; frame < 12; frame++) {
    const x = (frame % 4) * 160,
      y = Math.floor(frame / 4) * 200,
      eating = frame >= 8;
    const phase = (eating ? (frame - 8) / 4 : frame / 8) * Math.PI * 2;
    ctx.save();
    ctx.translate(x, y);
    if (vehicles.has(id) || floats.has(id)) {
      ctx.drawImage(
        source,
        0,
        floats.has(id) ? Math.sin(phase) * 2 : Math.sin(phase) * 0.4,
        160,
        200,
      );
    } else {
      // The overlap at the hips avoids a visible seam between torso and legs.
      for (let leg = 0; leg < 2; leg++) {
        const pivotX = leg === 0 ? 53 : 106,
          angle = eating ? 0 : Math.sin(phase + leg * Math.PI) * 0.1;
        ctx.save();
        ctx.translate(pivotX, 139);
        ctx.rotate(angle);
        ctx.translate(-pivotX, -139);
        ctx.drawImage(source, leg * 80, 134, 80, 66, leg * 80, 134, 80, 66);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(80, 139);
      ctx.rotate(
        eating ? -0.045 + Math.sin(phase) * 0.035 : Math.sin(phase) * 0.012,
      );
      ctx.translate(-80, -139);
      ctx.drawImage(
        source,
        0,
        0,
        160,
        141,
        eating ? -Math.max(0, Math.sin(phase)) * 3 : 0,
        eating ? 0 : -Math.abs(Math.sin(phase)) * 1.3,
        160,
        141,
      );
      ctx.restore();
    }
    ctx.restore();
    atlas.add(frame, 0, x, y, 160, 200);
  }
  atlas.refresh();
}
