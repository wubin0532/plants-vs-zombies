import type Phaser from "phaser";
import type { Zombie, Plant } from "./engine";
const vehicles = new Set(["zomboni", "bobsled", "catapult", "boss"]);
const floats = new Set(["ducky", "snorkel", "dolphin", "balloon", "bungee"]);
// Padding keeps swinging hands and feet inside their own atlas frame.
const bakedPadding = 24;
export const bakedFrame = { width: 208, height: 248 };
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
    width: natural ? 96 : 85 * bakedFrame.width / 160,
    height: natural ? 128 : 106 * bakedFrame.height / 200,
    origin: natural ? 249 / 256 : (193 + bakedPadding) / bakedFrame.height,
    extent: natural ? (id === "cone" ? 112 : id === "bucket" ? 101 : 88) : 106,
  };
}
export function zombieFrame(z: Zombie, natural = zombieAppearance(z).natural) {
  if (z.id === "dancer" && z.special?.kind === "summon")
    return 12 + Math.min(7, Math.floor(z.special.elapsed / z.special.duration * 8));
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
/** Shared texture regions: head motion never moves the planted roots. */
export const articulatedPlants = new Set([
  "pea", "snowpea", "repeater", "three", "split", "gatling", "cactus",
  "sunflower", "twin", "marigold", "puff", "sunshroom", "fume", "scaredy",
  "sea", "gloom", "cabbage", "kernel", "melon", "winter", "cattail",
]);
export function plantHeadPose(p: Plant, kind: string) {
  if (p.sleep) return { angle: 0, scaleX: 1, scaleY: 1 };
  const attack = p.attackAge ?? 10;
  const recoil = attack < 0.4 ? Math.sin(attack / 0.4 * Math.PI) : 0;
  const charge = p.timer > 0 && p.timer < 0.2
    ? Math.sin((1 - p.timer / 0.2) * Math.PI) : 0;
  const sway = Math.sin(p.age * (kind === "sun" ? 2 : 2.5) + p.uid);
  return {
    angle: sway * (kind === "sun" ? 3 : 1.2) +
      (kind === "lob" ? charge * -10 + recoil * 14 : recoil * -3),
    scaleX: 1 + sway * 0.012 + charge * 0.025 - recoil * 0.075,
    scaleY: 1 - sway * 0.012 - charge * 0.02 + recoil * 0.06,
  };
}

/** Additional whole-body motion uses the simulation clock, including slow/freeze. */
export function zombiePose(z: Zombie) {
  const phase = z.motion / 20 * Math.PI * 2;
  if (z.jump) return { angle: 0, lift: 0 };
  const transition = Math.min(1, (z.actionTime ?? 0.16) / 0.16);
  const weight = z.action === "eat" ? 1 - transition : transition;
  if (z.id === "dancer" || z.id === "backup")
    return { angle: Math.sin(phase) * 3 * weight, lift: 0 };
  if (z.id === "pogo")
    return { angle: Math.sin(phase) * 2 * weight, lift: Math.abs(Math.sin(phase)) * 12 * weight };
  if (floats.has(z.id))
    return { angle: Math.sin(phase) * 1.5 * weight, lift: Math.sin(phase) * 3 * weight };
  if (z.id === "football" || z.id === "imp" || z.id === "yeti")
    return { angle: (-2 + Math.sin(phase) * 1.5) * weight, lift: 0 };
  return { angle: 0, lift: 0 };
}
export function jumpHeight(z: Zombie) {
  if (!z.jump) return zombiePose(z).lift;
  const p = z.jump.elapsed / z.jump.duration;
  return (z.jump.fromHeight ?? 0) * (1 - p) + Math.sin(Math.PI * p) * 46;
}
/** Bake articulated walking/eating poses from the PNG torso and leg regions. */
export function bakeZombie(scene: Phaser.Scene, id: string) {
  const source = scene.textures
    .get("z-" + id)
    .getSourceImage() as HTMLImageElement;
  const dancing = id === "dancer" || id === "backup";
  const frames = id === "dancer" ? 20 : 12;
  const atlas = scene.textures.createCanvas("anim-" + id, bakedFrame.width * 4, Math.ceil(frames / 4) * bakedFrame.height)!;
  const ctx = atlas.context;
  for (let frame = 0; frame < frames; frame++) {
    const x = (frame % 4) * bakedFrame.width,
      y = Math.floor(frame / 4) * bakedFrame.height,
      eating = frame >= 8 && frame < 12,
      summoning = frame >= 12;
    const phase = (summoning ? (frame - 12) / 8 : eating ? (frame - 8) / 4 : frame / 8) * Math.PI * 2;
    ctx.save();
    ctx.translate(x + bakedPadding, y + bakedPadding);
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
          angle = eating ? 0 : Math.sin(phase + leg * Math.PI) *
            (dancing ? 0.2 : ["football", "imp", "yeti"].includes(id) ? 0.15 : 0.1);
        ctx.save();
        ctx.translate(pivotX, 139);
        ctx.rotate(angle);
        ctx.translate(-pivotX, -139);
        ctx.drawImage(source, leg * 80, 134, 80, 66, leg * 80, 134, 80, 66);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(80, 139);
      ctx.rotate(eating ? -0.045 + Math.sin(phase) * 0.035 :
        dancing ? Math.sin(phase) * 0.055 : Math.sin(phase) * 0.012);
      ctx.translate(-80, -139);
      if (dancing && !eating) {
        // Side strips articulate the arms; the central head/torso stays joined.
        for (let arm = 0; arm < 2; arm++) {
          const left = arm === 0, pivot = left ? 43 : 117;
          ctx.save();
          ctx.translate(pivot, 82);
          ctx.rotate((left ? -1 : 1) * (summoning
            ? 0.22 + Math.sin((frame - 12) / 7 * Math.PI) * 0.5
            : Math.sin(phase + arm * Math.PI) * 0.18));
          ctx.translate(-pivot, -82);
          ctx.drawImage(source, left ? 0 : 114, 65, 46, 76, left ? 0 : 114, 65, 46, 76);
          ctx.restore();
        }
        ctx.drawImage(source, 0, 0, 160, 66, 0, 0, 160, 66);
        ctx.drawImage(source, 43, 65, 74, 76, 43, 65, 74, 76);
      } else ctx.drawImage(
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
    atlas.add(frame, 0, x, y, bakedFrame.width, bakedFrame.height);
  }
  atlas.refresh();
}
