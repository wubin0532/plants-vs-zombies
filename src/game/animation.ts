import type Phaser from "phaser";
import type { Zombie, Plant } from "./engine";
import { motionZombieFrames, motionPlantFrames } from "./motion-manifest.generated";
import { plantIdleRange } from "./idle-motion.generated";
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
/** 用 AI 逐帧动作图集替换程序烘焙的僵尸；清单由 prepare-motion 生成，缺图不会加载。 */
export const motionZombies = Object.keys(motionZombieFrames);
export const isMotionZombie = (id: string) => id in motionZombieFrames;
/**
 * 植物动作图集：16 帧为「待机 0-7 / 蓄力 8-11 / 攻击 12-15」，
 * 8 帧为「待机 0-3 / 触发 4-7」。清单只包含已出图的角色。
 */
export const motionPlants = Object.keys(motionPlantFrames);
export const isMotionPlant = (id: string) => id in motionPlantFrames;
export const motionSheet = (id: string) =>
  ["garg", "pole"].includes(id)
    ? { frameWidth: 320, frameHeight: 320 }
    : isMotionZombie(id)
      ? { frameWidth: bakedFrame.width, frameHeight: bakedFrame.height }
      : { frameWidth: 192, frameHeight: 256 };
/**
 * 待机换帧频率（帧/秒）：大嘴花最活跃；待机姿势幅度大的植物保持基准帧，
 * 只靠渲染层的程序化呼吸，避免整片草坪非战斗时持续抖动。
 * 幅度来自 plantIdleRange（由 prepare-cards 从动作图实测生成）。
 */
function idleFrameRate(id: string): number {
  if (id === "chomper") return 2.8;
  const range = plantIdleRange[id] ?? 0;
  if (range > 12) return 0;
  return +(1 + (1 - range / 12) * 0.9).toFixed(2);
}
/** 待机姿势：慢速循环，uid 错开相位，避免整片草坪同步摆动；休眠时完全静止。 */
function idleFrame(p: Plant, count: number, rate: number): number {
  if (rate <= 0 || p.sleep) return 0;
  return Math.floor(p.age * rate + p.uid * 0.37) % count;
}
export function chomperFrame(p: Plant) {
  if (p.chomp) return 4 + Math.min(3, Math.floor((p.chomp.elapsed / 0.6) * 4));
  if (p.digest !== undefined && p.digest > 0)
    return 8 + (Math.floor(p.digest * 6) % 4);
  if (p.timer > 0 && p.timer <= 0.6)
    return 12 + Math.min(3, Math.floor(((0.6 - p.timer) / 0.6) * 4));
  // 大嘴花是招牌植物：待机也保持较快的咀嚼循环，是全场最活跃的一株。
  return idleFrame(p, 4, idleFrameRate("chomper"));
}
/**
 * 植物动作帧：8 帧组「触发 4-7 > 待机 0-3」，16 帧组「攻击 12-15 > 蓄力 8-11 > 待机 0-7」。
 *
 * 待机按 plantIdleRange 分档：姿势幅度小的植物小幅慢速循环，幅度大的
 * （豌豆、西瓜、玉米炮等）保持基准帧、只做程序化呼吸。蓄力、攻击、受击和
 * 产出永远优先——动作预算留给战斗，不同植物也因此有各自的待机节奏。
 */
export function plantMotionFrame(p: Plant) {
  const frames = motionPlantFrames[p.id] ?? 16;
  const attack = p.attackAge ?? 10;
  if (frames <= 8) {
    if (p.hurt && p.hurt > 0)
      return 4 + Math.min(3, Math.floor(Math.min(1, Math.max(0, 1 - p.hurt / 0.2)) * 4));
    if (attack < 0.45) return 4 + Math.min(3, Math.floor((attack / 0.45) * 4));
    return idleFrame(p, 4, idleFrameRate(p.id));
  }
  if (attack < 0.45) return 12 + Math.min(3, Math.floor((attack / 0.45) * 4));
  if (p.hurt && p.hurt > 0)
    return 8 + Math.min(3, Math.floor(Math.min(1, Math.max(0, 1 - p.hurt / 0.2)) * 4));
  if (p.timer > 0 && p.timer < 0.4)
    return 8 + Math.min(3, Math.floor(((0.4 - p.timer) / 0.4) * 4));
  return idleFrame(p, 8, idleFrameRate(p.id));
}
export type ZombieAppearance = {
  id: string;
  natural: boolean;
  texture: string;
  width: number;
  height: number;
  origin: number;
  extent: number;
};
/**
 * 僵尸外观表：结果只取决于「外观 id」，与其它运行状态无关，因此按 id 预计算并
 * 共享。渲染层每只僵尸每帧都要取一次，原来的对象字面量是稳定的 GC 来源。
 */
const appearanceCache = new Map<string, ZombieAppearance>();
function appearanceFor(id: string): ZombieAppearance {
  let appearance = appearanceCache.get(id);
  if (appearance) return appearance;
  const natural = (sequenceZombies as readonly string[]).includes(id);
  if (id === "garg" || id === "pole")
    appearance = {
      id,
      natural,
      texture: "walk-" + id,
      width: 160,
      height: 160,
      origin: 313 / 320,
      extent: id === "garg" ? 96 : 118,
    };
  else if (isMotionZombie(id))
    appearance = {
      id,
      natural: false,
      texture: "walk-" + id,
      width: 85 * bakedFrame.width / 160,
      height: 106 * bakedFrame.height / 200,
      // 动作图集由 prepare-motion 统一贴底到 frameHeight-7，脚底锚点随之改变。
      origin: (bakedFrame.height - 7) / bakedFrame.height,
      extent: 106,
    };
  else
    appearance = {
      id,
      natural,
      texture: (natural ? "walk-" : "anim-") + id,
      width: natural ? 96 : 85 * bakedFrame.width / 160,
      height: natural ? 128 : 106 * bakedFrame.height / 200,
      origin: natural ? 249 / 256 : (193 + bakedPadding) / bakedFrame.height,
      extent: natural ? (id === "cone" ? 112 : id === "bucket" ? 101 : 88) : 106,
    };
  appearanceCache.set(id, appearance);
  return appearance;
}
export function zombieAppearance(z: Zombie): ZombieAppearance {
  // 路障/铁桶/铁栅门被打碎后换回普通外观，其余情况直接用僵尸自身 id。
  const id =
    z.armor === 0 && ["cone", "bucket", "screen"].includes(z.id)
      ? "basic"
      : z.id;
  return appearanceFor(id);
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
  if (isMotionZombie(z.id)) {
    if (z.action === "eat" || (z.id === "catapult" && z.action === "special"))
      return 8 + (Math.floor((z.actionTime ?? z.age) * 6) % 4);
    return Math.floor(z.motion / 2.6) % 8;
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

/**
 * Additional whole-body motion uses the simulation clock, including slow/freeze.
 *
 * 结果写进调用方给的 `into`，不分配对象：渲染层每只僵尸每帧都要取一次角度与
 * 抬升，原本每帧一个对象字面量是稳定的垃圾来源。`zombiePose` 保留原来的
 * 「返回新对象」语义供测试与外部调用。
 */
export function zombieMotionInto(
  z: Zombie,
  into: { angle: number; lift: number },
) {
  const phase = z.motion / 20 * Math.PI * 2;
  if (z.jump) {
    into.angle = 0;
    into.lift = 0;
    return into;
  }
  const transition = Math.min(1, (z.actionTime ?? 0.16) / 0.16);
  const weight = z.action === "eat" ? 1 - transition : transition;
  if (z.id === "dancer" || z.id === "backup") {
    into.angle = Math.sin(phase) * 3 * weight;
    into.lift = 0;
  } else if (z.id === "pogo") {
    into.angle = Math.sin(phase) * 2 * weight;
    into.lift = Math.abs(Math.sin(phase)) * 12 * weight;
  } else if (floats.has(z.id)) {
    into.angle = Math.sin(phase) * 1.5 * weight;
    into.lift = Math.sin(phase) * 3 * weight;
  } else if (z.id === "football" || z.id === "imp" || z.id === "yeti") {
    into.angle = (-2 + Math.sin(phase) * 1.5) * weight;
    into.lift = 0;
  } else {
    into.angle = 0;
    into.lift = 0;
  }
  return into;
}
export function zombiePose(z: Zombie) {
  return zombieMotionInto(z, { angle: 0, lift: 0 });
}
/** 无分配的抬升查询，供每帧插值使用（jumpHeight 的标量内核）。 */
const liftScratch = { angle: 0, lift: 0 };
export function jumpHeight(z: Zombie) {
  if (!z.jump) return zombieMotionInto(z, liftScratch).lift;
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
