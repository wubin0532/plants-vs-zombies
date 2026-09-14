import type Phaser from "phaser";
import type { Zombie, Plant } from "./engine";
const vehicles = new Set(["zomboni", "bobsled", "catapult", "boss"]);
const floats = new Set(["ducky", "snorkel", "dolphin", "balloon", "bungee"]);
export const sequenceZombies = [
  "basic",
  "cone",
  "bucket",
  "garg",
  "pole",
] as const;
export const motionSheet = (id: string) =>
  ["garg", "pole"].includes(id)
    ? { frameWidth: 320, frameHeight: 320 }
    : { frameWidth: 192, frameHeight: 256 };
export function chomperFrame(p: Plant) {
  if (p.chomp) return 4 + Math.min(3, Math.floor((p.chomp.elapsed / 0.6) * 4));
  if (p.digest !== undefined && p.digest > 0)
    return 8 + (Math.floor(p.digest * 6) % 4);
  if (p.timer > 0 && p.timer <= 0.6)
    return 12 + Math.min(3, Math.floor(((0.6 - p.timer) / 0.6) * 4));
  return Math.floor(p.age * 4) % 4;
}
export function zombieAppearance(z: Zombie) {
  const id =
    z.armor === 0 && ["cone", "bucket", "screen"].includes(z.id)
      ? "basic"
      : z.id;
  const natural = (sequenceZombies as readonly string[]).includes(id);
  if (id === "garg" || id === "pole")
    return {
      id,
      natural,
      texture: "walk-" + id,
      width: 160,
      height: 160,
      origin: 313 / 320,
      extent: id === "garg" ? 96 : 118,
    };
  return {
    id,
    natural,
    texture: (natural ? "walk-" : "anim-") + id,
    width: natural ? 96 : 85,
    height: natural ? 128 : 106,
    origin: natural ? 249 / 256 : 0.965,
    extent: natural ? (id === "cone" ? 112 : id === "bucket" ? 101 : 88) : 106,
  };
}
export function zombieFrame(z: Zombie, natural = zombieAppearance(z).natural) {
  if (z.id === "garg") {
    if (z.special) {
      const phase = Math.min(3, Math.floor((z.special.elapsed / z.special.duration) * 4));
      // The source's third throw pose includes a detached imp. Use the empty-hand
      // follow-through once the engine spawns the independently animated imp.
      return z.special.kind === "throw" ? [12, 13, 15, 15][phase] : 8 + phase;
    }
    return z.action === "eat" ? 0 : Math.floor(z.motion / 2.6) % 8;
  }
  if (z.id === "pole") {
    if (z.jump)
      return z.jump.kind === "vault"
        ? 8 + Math.min(3, Math.floor((z.jump.elapsed / z.jump.duration) * 4))
        : (z.jumped ? 12 : 0) + (Math.floor(z.motion / 2.6) % 8);
    if (z.action === "eat")
      return 20 + (Math.floor((z.actionTime ?? z.age) * 6) % 4);
    return (z.jumped ? 12 : 0) + (Math.floor(z.motion / 2.6) % 8);
  }
  if (natural)
    return z.action === "eat"
      ? 12 + (Math.floor((z.actionTime ?? z.age) * 8) % 4)
      : Math.floor(z.motion / 2) % 12;
  return z.action === "eat"
    ? 8 + (Math.floor((z.actionTime ?? z.age) * 6) % 4)
    : Math.floor(z.motion / 2.6) % 8;
}
export function jumpHeight(z: Zombie) {
  if (!z.jump) return 0;
  const p = z.jump.elapsed / z.jump.duration;
  return (z.jump.fromHeight ?? 0) * (1 - p) + Math.sin(Math.PI * p) * 46;
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
