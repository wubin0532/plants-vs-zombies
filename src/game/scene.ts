import Phaser from "phaser";
import { plants, zombies, plantById } from "./content";
import { plantImage, zombieImage, gardenImage, effectImage } from "./art";
import { BOARD, cellX, cellY, feetY, cellAt, healthFraction } from "./layout";
import {
  bakeZombie,
  zombieFrame,
  jumpHeight,
  sequenceZombies,
  zombieAppearance,
  motionSheet,
  chomperFrame,
} from "./animation";
import { plantScale, zombieScale } from "./proportions";
import type { GardenAudio } from "./audio";
export type RenderOptions = {
  audio?: GardenAudio;
  quality?: () => string;
  shake?: () => boolean;
  contrast?: () => boolean;
};
import { Engine } from "./engine";

export class GardenScene extends Phaser.Scene {
  engine: Engine;
  objects = new Map<
    string,
    Phaser.GameObjects.Image | Phaser.GameObjects.Text
  >();
  graphics!: Phaser.GameObjects.Graphics;
  fog!: Phaser.GameObjects.Graphics;
  hover!: Phaser.GameObjects.Rectangle;
  ghost!: Phaser.GameObjects.Image;
  acc = 0;
  previous = new Map<number, { x: number; row: number; h: number }>();
  notify: () => void;
  lastNotify = 0;
  options: RenderOptions;
  lastShake = -10;
  wasPaused = false;
  constructor(engine: Engine, notify: () => void, options: RenderOptions = {}) {
    super("garden");
    this.engine = engine;
    this.notify = notify;
    this.options = options;
  }
  preload() {
    this.load.image("garden", gardenImage(this.engine.level.scene));
    for (const id of sequenceZombies)
      this.load.spritesheet(
        `walk-${id}`,
        `${import.meta.env.BASE_URL}assets/animation/${id}.png`,
        motionSheet(id),
      );
    this.load.spritesheet(
      "chomper-motion",
      `${import.meta.env.BASE_URL}assets/animation/chomper.png`,
      { frameWidth: 256, frameHeight: 256 },
    );
    for (const p of plants) this.load.image(p.id, plantImage(p.id));
    for (const z of zombies) this.load.image("z-" + z.id, zombieImage(z.id));
    for (let i = 0; i < 16; i++) this.load.image("fx-" + i, effectImage(i));
  }
  x(col: number) {
    return cellX(col);
  }
  y(row: number) {
    return cellY(row, this.engine.level.rows);
  }
  create() {
    this.add.image(600, 345, "garden").setDisplaySize(1200, 690);
    for (const z of zombies)
      if (!(sequenceZombies as readonly string[]).includes(z.id))
        bakeZombie(this, z.id);
    for (const id of ["cone", "bucket"]) {
      const texture = this.textures.createCanvas("armor-" + id, 160, 80)!;
      texture.context.drawImage(
        this.textures.get("z-" + id).getSourceImage() as HTMLImageElement,
        0,
        0,
        160,
        id === "cone" ? 64 : 70,
        0,
        0,
        160,
        id === "cone" ? 64 : 70,
      );
      texture.refresh();
    }
    const grid = this.add.graphics();
    for (let r = 0; r < this.engine.level.rows; r++)
      for (let c = 0; c < 9; c++) {
        grid.fillStyle((r + c) % 2 ? 0xffffff : 0x173916, 0.055);
        grid.fillRect(
          BOARD.left + c * BOARD.cell,
          BOARD.top + (r * BOARD.lawnHeight) / this.engine.level.rows,
          BOARD.cell,
          BOARD.lawnHeight / this.engine.level.rows,
        );
      }
    grid.lineStyle(1, 0xe9f0bf, 0.15);
    for (let c = 0; c <= 9; c++)
      grid.lineBetween(
        BOARD.left + c * BOARD.cell,
        BOARD.top,
        BOARD.left + c * BOARD.cell,
        BOARD.top + BOARD.lawnHeight,
      );
    this.graphics = this.add.graphics().setDepth(80);
    this.fog = this.add.graphics().setDepth(100);
    this.hover = this.add
      .rectangle(
        0,
        0,
        BOARD.cell - 2,
        BOARD.lawnHeight / this.engine.level.rows - 2,
        0xfff1b0,
        0.18,
      )
      .setStrokeStyle(2, 0xfff1b0, 0.8)
      .setVisible(false)
      .setDepth(101);
    this.ghost = this.add
      .image(0, 0, "pea")
      .setAlpha(0.5)
      .setOrigin(0.5, 0.95)
      .setDisplaySize(86, 86)
      .setVisible(false)
      .setDepth(100);
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const { col: c, row: r } = cellAt(p.x, p.y, this.engine.level.rows);
      const inLawn =
        c >= 0 && c < 9 && r >= 0 && r < this.engine.level.rows;
      const id = this.engine.selected;
      this.hover.setVisible(inLawn && !!id);
      this.hover.setPosition(this.x(c), this.y(r));
      if (inLawn && id && id !== "shovel" && plantById[id]) {
        this.ghost
          .setTexture(id === "chomper" ? "chomper-motion" : id)
          .setPosition(this.x(c), feetY(r, this.engine.level.rows))
          .setVisible(true);
        if (id === "chomper") this.ghost.setFrame(0);
        if (this.engine.canPlant(id, r, c)) this.ghost.clearTint();
        else this.ghost.setTint(0xe05545);
      } else this.ghost.setVisible(false);
    });
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.engine.selected = "";
        this.engine.cannon = 0;
        this.hover.setVisible(false);
        this.ghost.setVisible(false);
        this.notify();
        return;
      }
      if (this.engine.paused) return;
      const token = this.engine.tokens.find(
        (t) =>
          Phaser.Math.Distance.Between(this.x(t.x), this.y(t.row), p.x, p.y) <
          31,
      );
      if (token) {
        this.engine.collect(token.uid);
        this.notify();
        return;
      }
      if (this.engine.level.mode === "whack") {
        const zombie = this.engine.zombies.find(
          (z) =>
            Phaser.Math.Distance.Between(this.x(z.x), this.y(z.row), p.x, p.y) <
            48,
        );
        if (zombie) {
          this.engine.hitZombie(zombie.uid);
          return;
        }
      }
      const { row, col } = cellAt(p.x, p.y, this.engine.level.rows);
      this.engine.click(row, col, (p.event as MouseEvent).shiftKey);
    });
  }
  sprite(
    key: string,
    texture: string,
    x: number,
    y: number,
    width: number,
    height: number,
    depth: number,
  ) {
    let obj = this.objects.get(key) as Phaser.GameObjects.Image;
    if (!obj) {
      obj = this.add.image(x, y, texture);
      this.objects.set(key, obj);
    }
    if (obj.texture.key !== texture) obj.setTexture(texture);
    obj
      .setPosition(x, y)
      .setDisplaySize(width, height)
      .setDepth(depth)
      .setOrigin(0.5)
      .setAlpha(1)
      .setAngle(0);
    return obj;
  }
  update(_time: number, delta: number) {
    if (!this.graphics) return;
    const e = this.engine;
    if (e.hitStop > 0) e.hitStop = Math.max(0, e.hitStop - delta / 1000);
    else
      this.acc +=
        Math.min(delta / 1000, 0.1) *
        e.timeScale *
        (e.winDelay >= 0 ? 0.3 : 1);
    while (this.acc >= 1 / 60) {
      this.previous.clear();
      for (const z of e.zombies)
        this.previous.set(z.uid, { x: z.x, row: z.row, h: jumpHeight(z) });
      e.step(1 / 60);
      this.acc -= 1 / 60;
    }
    if (e.paused || e.status !== "playing") {
      if (!this.wasPaused) {
        this.options.audio?.stop();
        this.cameras.main.shakeEffect.reset();
      }
      e.drainSounds();
    } else
      for (const sound of e.drainSounds())
        this.options.audio?.play(sound.kind, sound.x, sound.source);
    if (!e.paused && e.status === "playing")
      this.options.audio?.update(e.time, e.zombies.length / 18);
    this.wasPaused = e.paused || e.status !== "playing";
    if (this.ghost.visible && !e.selected) this.ghost.setVisible(false);
    if (_time - this.lastNotify > 80) {
      this.notify();
      this.lastNotify = _time;
    }

    const keep = new Set<string>();
    const g = this.graphics;
    g.clear();
    for (const tile of e.tiles) {
      const x = this.x(tile.col),
        y = this.y(tile.row);
      if (tile.type === "grave") {
        g.fillStyle(0x77887d);
        g.fillRoundedRect(x - 25, y - 30, 50, 61, 13);
        g.lineStyle(3, 0x536456);
        g.strokeRoundedRect(x - 25, y - 30, 50, 61, 13);
        g.lineStyle(4, 0xa8b4a0);
        g.lineBetween(x, y - 15, x, y + 9);
        g.lineBetween(x - 10, y - 6, x + 10, y - 6);
      } else if (tile.type === "vase") {
        g.fillStyle(0xb79b73);
        g.fillEllipse(x, y + 1, 47, 55);
        g.fillRoundedRect(x - 17, y - 34, 34, 14, 3);
        g.lineStyle(3, 0x735c48);
        g.strokeEllipse(x, y + 1, 47, 55);
        g.lineBetween(x - 17, y - 16, x + 17, y - 16);
      } else {
        g.fillStyle(tile.type === "ice" ? 0xc6e4df : 0x466038, 0.65);
        g.fillEllipse(x, y + 20, 84, 27);
      }
    }
    for (const p of e.plants) {
      const key = "p" + p.uid;
      keep.add(key);
      const base = p.layer === "base",
        bodyScale = plantScale(p.id);
      const stable =
        base ||
        [
          "wallnut",
          "tallnut",
          "pumpkin",
          "potato",
          "spike",
          "spikerock",
          "pot",
        ].includes(p.id);
      const breathing = stable ? 0 : Math.sin(e.time * 2.5 + p.uid) * 0.012;
      const attackTime = p.attackAge ?? 10;
      const recoil =
        attackTime < 0.32 ? Math.sin((attackTime / 0.32) * Math.PI) : 0;
      const anticipation =
        !p.sleep &&
        ["shooter", "lob", "homing", "shroom"].includes(plantById[p.id].kind) &&
        p.timer > 0 &&
        p.timer < 0.18
          ? Math.sin((1 - p.timer / 0.18) * Math.PI) * 0.035
          : 0;
      const obj = this.sprite(
        key,
        p.id === "chomper" ? "chomper-motion" : p.id,
        this.x(p.col) + (p.hurt ? Math.sin(p.hurt * 65) * 3 : 0),
        feetY(p.row, e.level.rows) - (base ? 0 : 0),
        (base ? 90 : 86) * bodyScale,
        (base ? 45 : 86) * bodyScale,
        p.row * 10 + (base ? 1 : p.layer === "armor" ? 4 : 3),
      );
      if (p.id === "chomper")
        obj
          .setFrame(chomperFrame(p))
          .setDisplaySize(86 * bodyScale, 86 * bodyScale);
      obj
        .setOrigin(0.5, p.id === "chomper" ? 249 / 256 : 0.95)
        .setAlpha(p.sleep ? 0.65 : 1);
      obj.setScale(
        obj.scaleX * (1 + breathing + anticipation - recoil * 0.065),
        obj.scaleY * (1 - breathing - anticipation + recoil * 0.045),
      );
      obj.setAngle(
        stable ? 0 : Math.sin(e.time * 2 + p.uid) * 0.7 - recoil * 2,
      );
      if (
        ["cherry", "doom", "jalapeno"].includes(p.id) &&
        p.age < 1 &&
        !p.sleep
      ) {
        obj.setTint(p.age % 0.3 < 0.15 ? 0xffb29e : 0xffffff);
        obj.setScale(
          obj.scaleX * (1 + p.age * 0.12),
          obj.scaleY * (1 + p.age * 0.12),
        );
      }
      if (p.hp < p.max || plantById[p.id].hp > 300) {
        const barWidth = 44 * bodyScale;
        g.fillStyle(0x344638);
        g.fillRoundedRect(this.x(p.col) - barWidth / 2, this.y(p.row) + 34, barWidth, 5, 2);
        g.fillStyle(0xa7d363);
        g.fillRoundedRect(
          this.x(p.col) - barWidth / 2,
          this.y(p.row) + 34,
          barWidth * healthFraction(p.hp, p.max),
          5,
          2,
        );
      }
      if (p.sleep) {
        g.lineStyle(2, 0xdedbc2);
        const x = this.x(p.col) + 15,
          y = this.y(p.row) - 35;
        g.strokePoints([
          { x, y },
          { x: x + 9, y },
          { x, y: y + 9 },
          { x: x + 9, y: y + 9 },
        ]);
      }
      if (p.ready && p.id === "cob") {
        g.lineStyle(3, 0xffe692);
        g.strokeCircle(this.x(p.col), this.y(p.row), 36);
      }
    }
    for (const z of e.zombies) {
      const key = "z" + z.uid;
      keep.add(key);
      const scale = zombieScale(z.id, e.level.id);
      const appearance = zombieAppearance(z);
      const { natural, texture } = appearance;
      const previous = this.previous.get(z.uid);
      const blend = e.paused ? 1 : Math.min(1, this.acc * 60);
      const renderX = previous ? previous.x + (z.x - previous.x) * blend : z.x;
      const renderRow = z.laneChange
        ? z.laneChange.from +
          (z.row - z.laneChange.from) * Math.min(1, z.laneChange.elapsed / 0.6)
        : z.row;
      const currentJump = jumpHeight(z);
      const jump = previous
          ? previous.h + (currentJump - previous.h) * blend
          : currentJump,
        foot = feetY(renderRow, e.level.rows) - jump;
      const obj = this.sprite(
        key,
        texture,
        this.x(renderX) + (z.hurt ? Math.sin(z.hurt * 65) * 2 : 0),
        foot,
        appearance.width * scale,
        appearance.height * scale,
        5 + z.row * 10,
      );
      obj
        .setFrame(zombieFrame(z, natural))
        .setDisplaySize(appearance.width * scale, appearance.height * scale)
        .setOrigin(0.5, appearance.origin)
        .setFlipX(z.reverse)
        .setAlpha(z.underground ? 0.25 : 1);
      obj.setTint(
        z.freeze > 0
          ? 0x9edbec
          : z.golden
            ? 0xffd94d
            : z.slow > 0
              ? this.options.contrast?.()
                ? 0x2e6f8e
                : 0xc3e6ed
              : z.ally
                ? 0xe0b0ed
                : (z.boost ?? 1) > 1
                  ? 0xff9d8a
                  : 0xffffff,
      );
      if (z.flying) obj.y -= 17;
      if (!z.underground) {
        const width = 45 * scale,
          left = this.x(renderX) - width / 2,
          top = obj.y - appearance.extent * scale - 7;
        const health = healthFraction(z.hp, z.max);
        g.fillStyle(0x1b2726, 0.85);
        g.fillRoundedRect(
          left - 2,
          top - 2,
          width + 4,
          z.maxArmor > 0 && z.armor > 0 ? 13 : 8,
          3,
        );
        g.fillStyle(
          health > 0.5 ? 0x88ca58 : health > 0.25 ? 0xf1c552 : 0xe26958,
        );
        g.fillRect(left, top, width * health, 4);
        if (z.armor > 0) {
          g.fillStyle(0x99cfdf);
          g.fillRect(
            left,
            top + 6,
            width * healthFraction(z.armor, z.maxArmor),
            3,
          );
        }
        if (z.freeze > 0) {
          g.lineStyle(2, 0xd5f6ff, 0.8);
          g.strokeEllipse(
            this.x(z.x),
            foot - 28 * scale,
            62 * scale,
            59 * scale,
          );
        }
      }
    }
    for (const t of e.tokens) {
      const x = this.x(t.x),
        y = this.y(t.row) + Math.sin(e.time * 3 + t.uid) * 3;
      g.fillStyle(t.coin ? 0xebc064 : 0xffd75c, 0.22);
      g.fillCircle(x, y, 29);
      g.fillStyle(t.coin ? 0xdba641 : 0xffe28a);
      g.fillCircle(x, y, t.coin ? 14 : 20);
      g.lineStyle(3, t.coin ? 0xffe1a0 : 0xf9bb44);
      g.strokeCircle(x, y, t.coin ? 12 : 18);
      if (!t.coin) {
        g.lineStyle(3, 0xffd75c);
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 + e.time * 0.2;
          g.lineBetween(
            x + Math.cos(a) * 23,
            y + Math.sin(a) * 23,
            x + Math.cos(a) * 28,
            y + Math.sin(a) * 28,
          );
        }
      }
    }
    for (const b of e.bowls) {
      const key = "b" + b.uid;
      keep.add(key);
      this.sprite(
        key,
        b.explosive ? "cherry" : "wallnut",
        this.x(b.x),
        this.y(b.row),
        75,
        82,
        70,
      ).setAngle(e.time * 300);
    }
    for (const s of e.shots) {
      const lob = ["cabbage", "kernel", "melon", "winter"].includes(s.type);
      const progress = Math.min(
        1,
        Math.abs(s.x - s.originX) /
          Math.max(0.1, Math.abs(s.destinationX - s.originX)),
      );
      const x = this.x(s.x),
        y =
          feetY(s.row, e.level.rows) -
          55 -
          (lob ? Math.sin(progress * Math.PI) * 100 : 0);
      g.fillStyle(
        ["snowpea", "winter"].includes(s.type)
          ? 0xafedfa
          : s.type === "fire"
            ? 0xf6b54f
            : s.type === "star"
              ? 0xffdc7a
              : 0xb4d96a,
      );
      g.fillCircle(x, y, ["melon", "winter"].includes(s.type) ? 12 : 7);
      g.fillStyle(0xf0f5cb, 0.7);
      g.fillCircle(x - 2, y - 3, 2);
    }
    const quality = this.options.quality?.() || "high";
    const limit = quality === "low" ? 32 : quality === "medium" ? 60 : 90;
    for (const fx of e.effects.slice(-limit)) {
      const t = 1 - fx.life / fx.duration,
        x = this.x(fx.x),
        y = this.y(fx.row),
        key = "fx" + fx.uid;
      let frame = 15,
        size = 35,
        alpha = 1 - t;
      if (fx.type === "boom") {
        frame = (fx.source === "doom" ? 4 : 0) + Math.min(3, Math.floor(t * 4));
        if (fx.source === "potato") frame = 10;
        if (fx.source === "cob") frame = Math.min(3, 1 + Math.floor(t * 3));
        if (fx.source === "jalapeno") frame = 14;
        size =
          fx.source === "cob"
            ? 340
            : fx.source === "doom"
              ? 440
              : fx.source === "potato"
                ? 130
                : fx.source === "jalapeno"
                  ? 110
                  : 285;
        if (
          this.options.shake?.() !== false &&
          !e.paused &&
          e.time - this.lastShake > 0.7 &&
          t < 0.08
        ) {
          this.cameras.main.shake(160, 0.002);
          this.lastShake = e.time;
        }
        alpha = t > 0.85 ? (1 - t) / 0.15 : 1;
      } else if (fx.type === "smash") {
        frame = 10;
        size = 125;
        alpha = 1 - t;
        if (
          this.options.shake?.() !== false &&
          !e.paused &&
          e.time - this.lastShake > 0.5 &&
          t < 0.08
        ) {
          this.cameras.main.shake(120, 0.0018);
          this.lastShake = e.time;
        }
      } else if (fx.type === "chomp") {
        frame = 11;
        size = 38;
      } else if (fx.type === "break") {
        if (fx.source === "cone" || fx.source === "bucket") {
          keep.add(key);
          this.sprite(
            key,
            "armor-" + fx.source,
            x + 24 + t * 48,
            y - 75 - 35 * Math.sin(t * Math.PI) + t * t * 55,
            75,
            38,
            74,
          )
            .setAngle(t * 160)
            .setAlpha(1 - t);
          continue;
        }
        frame = 10;
        size = 70;
      } else if (fx.type === "ice") {
        frame = t < 0.45 ? 8 : 9;
        size = 180;
      } else if (
        fx.type === "plant" ||
        fx.type === "land" ||
        fx.type === "shovel"
      ) {
        frame = fx.type === "plant" ? 11 : 10;
        size = 65;
      } else if (fx.type === "sun" || fx.type === "collect") {
        frame = 13;
        size = 60;
      } else if (fx.type === "spore") {
        frame = 9;
        size = 170;
      } else if (fx.type === "fly") {
        // Sun/coin icon accelerating toward the seed-tray corner.
        const ease = t * t;
        const flyX = x + (60 - x) * ease,
          flyY = y + (14 - y) * ease - Math.sin(Math.PI * t) * 46;
        g.fillStyle(fx.source === "coin" ? 0xe8b04b : 0xffd94d, 1 - t * 0.4);
        g.fillCircle(flyX, flyY, 12);
        if (fx.source === "coin") {
          g.fillStyle(0xb9832e, 1 - t * 0.4);
          g.fillCircle(flyX, flyY, 7);
        }
        continue;
      } else if (fx.type === "death" && fx.source) {
        keep.add(key);
        if (fx.zombie) {
          const z = fx.zombie,
            appearance = zombieAppearance(z);
          const scale = zombieScale(z.id, e.level.id);
          this.sprite(
            key,
            appearance.texture,
            x,
            feetY(fx.row, e.level.rows) + t * 8 - (fx.height ?? 0) * (1 - t),
            appearance.width * scale,
            appearance.height * scale,
            5 + fx.row * 10,
          )
            .setFrame(zombieFrame(z, appearance.natural))
            .setDisplaySize(appearance.width * scale, appearance.height * scale)
            .setOrigin(0.5, appearance.origin)
            .setFlipX(z.reverse)
            .setAngle(t * 78 * (z.reverse ? -1 : 1))
            .setAlpha(1 - t);
        } else
          this.sprite(key, "z-" + fx.source, x, y + 15, 78, 98, 65)
            .setAngle(t * 70)
            .setAlpha(1 - t);
        continue;
      } else if (fx.type === "shoot") {
        frame = 15;
        size = 23;
      } else if (fx.type === "mower") {
        frame = 10;
        size = 80;
      }
      keep.add(key);
      const image = this.sprite(
        key,
        "fx-" + frame,
        fx.type === "collect" ? x + (30 - x) * t : x,
        fx.type === "collect" ? y + (-20 - y) * t : y,
        size * (0.8 + t * 0.3),
        size * (0.8 + t * 0.3),
        72,
      ).setAlpha(alpha);
      if (fx.type === "spore") image.setTint(0xb68cde);
      if (fx.type === "boom" && quality !== "low")
        for (let i = 0; i < (quality === "high" ? 6 : 3); i++) {
          const k = key + "-" + i;
          keep.add(k);
          const angle = (i * 2.4 + fx.uid) * 1.7,
            distance = t * 100;
          this.sprite(
            k,
            "fx-" + (fx.source === "potato" ? 10 : 12),
            x + Math.cos(angle) * distance,
            y + Math.sin(angle) * distance - t * 30,
            22 + t * 35,
            22 + t * 35,
            71,
          )
            .setAlpha((1 - t) * 0.55)
            .setAngle(i * 60 + t * 90);
        }
    }
    for (let r = 0; r < e.level.rows; r++) {
      if (e.spareMowers[r]) {
        const x = BOARD.mowerX,
          y = this.y(r) - 8;
        g.fillStyle(0x526b4c);
        g.fillRoundedRect(x - 12, y - 10, 24, 14, 4);
        g.fillStyle(0xd69459);
        g.fillRoundedRect(x - 8, y - 14, 14, 9, 2);
        g.fillStyle(0x3c4d3d);
        g.fillCircle(x - 7, y + 4, 4);
        g.fillCircle(x + 7, y + 4, 4);
      }
      if (e.mowers[r]) {
        const x = BOARD.mowerX,
          y = this.y(r) + 19;
        g.fillStyle(0x526b4c);
        g.fillRoundedRect(x - 18, y - 14, 35, 20, 5);
        g.fillStyle(0xd69459);
        g.fillRoundedRect(x - 12, y - 20, 20, 13, 3);
        g.fillStyle(0x3c4d3d);
        g.fillCircle(x - 11, y + 5, 6);
        g.fillCircle(x + 11, y + 5, 6);
        g.lineStyle(3, 0xc5c2a4);
        g.lineBetween(x - 8, y - 16, x - 14, y - 34);
      }
    }
    if (e.level.mode === "boss") {
      const key = "boss";
      keep.add(key);
      this.sprite(key, "z-boss", 1130, 320, 140, 180, 60).setAlpha(
        e.bossDown > 0 ? 1 : 0.5,
      );
      if (e.bossBall) {
        g.fillStyle(e.bossBall.type === "fire" ? 0xf8ad54 : 0xa5dcea);
        g.fillCircle(this.x(e.bossBall.x), this.y(e.bossBall.row), 30);
      }
    }
    for (const [k, obj] of this.objects)
      if (!keep.has(k)) {
        obj.destroy();
        this.objects.delete(k);
      }
    this.fog.clear();
    if (
      e.level.scene === "fog" &&
      e.fogClear <= 0 &&
      !(e.level.mode === "storm" && e.time % 8 < 1)
    ) {
      for (let r = 0; r < e.level.rows; r++)
        for (let c = 4; c < 9; c++) {
          const lit = e.plants.some(
            (p) =>
              p.id === "lantern" &&
              Math.abs(p.col - c) <= 2 &&
              Math.abs(p.row - r) <= 1,
          );
          if (!lit) {
            this.fog.fillStyle(0xc4d8cf, 0.66);
            this.fog.fillRoundedRect(
              this.x(c) - 58,
              this.y(r) - 50,
              116,
              110,
              32,
            );
          }
        }
    }
  }
}
export function mountGame(
  parent: HTMLElement,
  engine: Engine,
  notify: () => void,
  options: RenderOptions = {},
) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 1200,
    height: 690,
    transparent: true,
    antialias: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: new GardenScene(engine, notify, options),
    audio: { noAudio: true },
  });
}
