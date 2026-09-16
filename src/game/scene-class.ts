import { FogRenderer } from "./fog-render";
import { foggedAt, lanternsIn } from "./visibility";
import { presentationAssets, presentationImage, projectileVisual, projectileHidden, plantAccent, plantBodyPose, zombieAccent, zombieVisualPose } from "./presentation";
import Phaser from "phaser";
import { plants, zombies, plantById } from "./content";
import { plantImage, zombieImage, gardenImage, effectImage, bowlImage } from "./art";
import { BOARD, cellX, cellY, feetY, cellAt, healthFraction } from "./layout";
import {
  bakeZombie,
  zombieFrame,
  jumpHeight,
  sequenceZombies,
  zombieAppearance,
  motionSheet,
  chomperFrame,
  articulatedPlants,
  plantHeadPose,
  zombiePose,
} from "./animation";
import { plantScale, zombieScale } from "./proportions";
import { bakeMower } from "./mower";
import { tokenPose, weatherOpacity, WIND_DURATION } from "./ambient";
import { drawWeather, drawToken } from "./ambient-render";
import type { GardenAudio } from "./audio";
export type RenderOptions = {
  audio?: GardenAudio;
  quality?: () => string;
  shake?: () => boolean;
  contrast?: () => boolean;
  pickupTarget?: (coin: boolean) => { x: number; y: number } | undefined;
};
import { Engine } from "./engine";

export class GardenScene extends Phaser.Scene {
  engine: Engine;
  objects = new Map<
    string,
    Phaser.GameObjects.Image | Phaser.GameObjects.Text
  >();
  graphics!: Phaser.GameObjects.Graphics;
  weather!: Phaser.GameObjects.Graphics;
  mist!: FogRenderer;
  waterSurface!: Phaser.GameObjects.Graphics;
  lightPreview!: Phaser.GameObjects.Graphics;
  terrain!: Phaser.GameObjects.Graphics;
  terrainCache!: Phaser.GameObjects.RenderTexture;
  terrainKey = "";
  keep = new Set<string>();
  hover!: Phaser.GameObjects.Rectangle;
  ghost!: Phaser.GameObjects.Image;
  acc = 0;
  previous = new Map<number, { x: number; row: number; h: number }>();
  notify: () => void;
  lastNotify = 0;
  options: RenderOptions;
  lastShake = -10;
  wasPaused = false;
  realTime = 0;
  constructor(engine: Engine, notify: () => void, options: RenderOptions = {}) {
    super("garden");
    this.engine = engine;
    this.notify = notify;
    this.options = options;
  }
  preload() {
    this.load.image("garden", gardenImage(this.engine.level.scene));
    for (const id of presentationAssets) this.load.image("art-" + id, presentationImage(id));
    for (const id of sequenceZombies)
      this.load.spritesheet(
        `walk-${id}`,
        `${import.meta.env.BASE_URL}assets/animation/${id}.webp`,
        motionSheet(id),
      );
    this.load.spritesheet(
      "chomper-motion",
      `${import.meta.env.BASE_URL}assets/animation/chomper.webp`,
      { frameWidth: 256, frameHeight: 256 },
    );
    for (const p of plants) this.load.image(p.id, plantImage(p.id));
    for (const element of ["ice", "electric"] as const) this.load.image("b-" + element, bowlImage(element));
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
    let background = "garden";
    if (this.engine.level.scene === "fog") {
      // Fog artwork's pool was 30px above the actual water lanes. Remap only the
      // lawn bands; the house, fence and coordinate system remain untouched.
      const calibrated = this.textures.createCanvas("fog-garden-aligned", 1200, 690)!;
      const source = this.textures.get("garden").getSourceImage() as HTMLImageElement;
      const g = calibrated.context;
      g.drawImage(source, 0, 0, 1200, 690);
      const top = BOARD.top, waterTop = top + BOARD.lawnHeight / 3;
      const waterBottom = top + BOARD.lawnHeight * 2 / 3, bottom = top + BOARD.lawnHeight;
      for (const [sy, sh, dy, dh] of [
        [top, 254 - top, top, waterTop - top],
        [254, 178, waterTop, waterBottom - waterTop],
        [432, bottom - 432, waterBottom, bottom - waterBottom],
      ]) g.drawImage(source, BOARD.left, sy, BOARD.cell * 9, sh, BOARD.left, dy, BOARD.cell * 9, dh);
      calibrated.refresh(); background = "fog-garden-aligned";
    }
    this.add.image(600, 345, background).setDisplaySize(1200, 690);
    this.waterSurface = this.add.graphics().setDepth(0.3);
    bakeMower(this);
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
    this.weather = this.add.graphics().setDepth(100.5);
    this.terrain = this.add.graphics().setVisible(false);
    this.mist = new FogRenderer(this);
    this.lightPreview = this.add.graphics().setDepth(101);
    // RenderTexture 继承 Image，默认原点是 (0.5, 0.5)；不改成左上角的话
    // 整张贴图会往左上偏移半张，墓碑、罐子、冰道和迷雾都会画到屏幕外。
    this.terrainCache = this.add
      .renderTexture(0, 0, 1200, 690)
      .setOrigin(0, 0)
      // 地块是地面装饰（墓碑、罐子、冰道、弹坑），要压在植物和僵尸下面。
      .setDepth(0.5);
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
    // 拖动预览：单一本体 + 有效/无效染色，避免光晕造成重影。
    this.ghost = this.add
      .image(0, 0, "pea")
      .setAlpha(0.82)
      .setOrigin(0.5, 0.95)
      .setDisplaySize(86, 86)
      .setVisible(false)
      .setDepth(100);
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.preview(p));
    this.input.on("gameout", () => { this.ghost.setVisible(false); this.hover.setVisible(false); });
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.engine.cancelSelection();
        this.hover.setVisible(false);
        this.ghost.setVisible(false);
        this.notify();
        return;
      }
      if (this.engine.paused) return;
      const token = this.engine.tokens.find(t => {
        const pose = tokenPose(t, this.engine.level.rows);
        return Phaser.Math.Distance.Between(pose.x, pose.y, p.x, p.y) < 31;
      });
      if (token) {
        this.engine.collect(token.uid);
        this.notify();
        return;
      }
      if (this.engine.selected === "tool") {
        if (this.engine.level.mode === "bowling" && !this.engine.toolSource) {
          const b = this.engine.bowls.find(b => Phaser.Math.Distance.Between(this.x(b.x), this.y(b.row), p.x, p.y) < 48);
          if (b) this.engine.selectBowl(b.uid);
        } else {
          const { row, col } = cellAt(p.x, p.y, this.engine.level.rows);
          this.engine.useTool(row, col);
        }
        this.preview(p);
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
          this.notify();
          return;
        }
      }
      const { row, col } = cellAt(p.x, p.y, this.engine.level.rows);
      this.engine.click(row, col, (p.event as MouseEvent).shiftKey);
    });
    // 从顶部卡片直接拖到草坪：抬手时在落点种植（点选种植在 pointerdown 已处理）。
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      // Always clear the transient preview first.  A cancelled/invalid drag
      // must not leave the previous plant half-rendered for the next drag.
      this.resetGhost();
      // 按下发生在画布内说明是普通点选，pointerdown 已经种过了。
      if (p.downElement === this.game.canvas) return;
      const id = this.engine.selected;
      if (!id || id === "shovel" || !plantById[id]) return;
      if (this.engine.paused || this.engine.status !== "playing") return;
      const { row, col } = cellAt(p.x, p.y, this.engine.level.rows);
      if (col < 0 || col > 8 || row < 0 || row >= this.engine.level.rows)
        return;
      this.engine.click(row, col);
      this.notify();
    });
    this.input.on("pointercancel", () => this.resetGhost());
  }
  resetGhost() {
    this.ghost.setVisible(false).clearTint().setAlpha(0.82).setScale(1);
    this.lightPreview.clear();
  }
  preview(pointer: Phaser.Input.Pointer) {
    const e = this.engine;
    const { col, row } = cellAt(pointer.x, pointer.y, e.level.rows);
    const active = e.inBoard(row, col) && !!e.selected && !e.paused && e.status === "playing";
    this.hover.setVisible(active).setPosition(this.x(col), this.y(row));
    const moving = e.selected === "tool" && e.level.mode !== "bowling" && e.level.mode !== "whack";
    const plant = moving ? e.plants.find(p => p.uid === e.toolSource) : undefined;
    const id = moving ? plant?.id : e.selected;
    const reason = e.selected === "tool" ? e.toolTargetReason(row, col) : id ? e.canPlant(id, row, col) : "";
    this.hover.setStrokeStyle(2, reason ? 0xe05545 : 0xb9ed78, 0.9);
    this.resetGhost();
    this.lightPreview.clear();
    if (active && id === "lantern") {
      const left = Math.max(0, col - 2), right = Math.min(8, col + 2);
      const top = Math.max(0, row - 1), bottom = Math.min(e.level.rows - 1, row + 1);
      const h = BOARD.lawnHeight / e.level.rows;
      this.lightPreview.fillStyle(reason ? 0xe05545 : 0xffdc82, .10);
      this.lightPreview.lineStyle(2, reason ? 0xe05545 : 0xffdc82, .85);
      this.lightPreview.fillRect(BOARD.left + left * BOARD.cell, BOARD.top + top * h, (right - left + 1) * BOARD.cell, (bottom - top + 1) * h);
      this.lightPreview.strokeRect(BOARD.left + left * BOARD.cell, BOARD.top + top * h, (right - left + 1) * BOARD.cell, (bottom - top + 1) * h);
    }
    if (active && id && plantById[id]) {
      // setTexture does not reset all display state on every Phaser version.
      // Reset frame/crop/scale explicitly so the second selected card gets the
      // complete portrait instead of inheriting a clipped previous frame.
      this.ghost
        .setTexture(id === "chomper" ? "chomper-motion" : id)
        // Plant rendering adds named `roots` / `head` frames to the portrait
        // texture.  Numeric frame 0 is not the full-image frame once those
        // regions exist; explicitly select Phaser's immutable base frame.
        .setFrame("__BASE")
        .setCrop()
        .setOrigin(0.5, id === "chomper" ? 249 / 256 : 0.95)
        .setDisplaySize(86 * plantScale(id), 86 * plantScale(id))
        .setAlpha(0.82)
        .setPosition(this.x(col), feetY(row, e.level.rows))
        .setVisible(true);
      if (reason) this.ghost.setTint(0xe05545); else this.ghost.clearTint();
    }
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
    if (texture.startsWith("anim-") && !this.textures.exists(texture))
      bakeZombie(this, texture.slice(5));
    let obj = this.objects.get(key) as Phaser.GameObjects.Image;
    if (!obj) {
      obj = this.add.image(x, y, texture);
      this.objects.set(key, obj);
    }
    if (obj.texture.key !== texture) obj.setTexture(texture);
    // Phaser queues a display-list sort even when setDepth receives the same value.
    if (obj.depth !== depth) obj.setDepth(depth);
    obj
      .setPosition(x, y)
      .setDisplaySize(width, height)
      .setOrigin(0.5)
      .setAlpha(1)
      .setAngle(0)
      .clearTint();
    return obj;
  }
  update(_time: number, delta: number) {
    if (!this.graphics) return;
    const e = this.engine;
    this.realTime += delta / 1000;
    if (e.hitStop > 0) e.hitStop = Math.max(0, e.hitStop - delta / 1000);
    else
      this.acc +=
        Math.min(delta / 1000, 0.1) *
        e.timeScale *
        (e.winDelay >= 0 ? 0.3 : 1);
    while (this.acc >= 1 / 60) {
      for (const z of e.zombies) {
        let previous = this.previous.get(z.uid);
        if (!previous) {
          previous = { x: z.x, row: z.row, h: 0 };
          this.previous.set(z.uid, previous);
        }
        previous.x = z.x;
        previous.row = z.row;
        previous.h = jumpHeight(z);
      }
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
      this.options.audio?.update(this.realTime, e.zombies.length / 18, e.level.scene);
    this.wasPaused = e.paused || e.status !== "playing";
    this.preview(this.input.activePointer);
    if (_time - this.lastNotify > 80) {
      this.notify();
      this.lastNotify = _time;
    }

    const keep = this.keep;
    keep.clear();
    const g = this.graphics;
    g.clear();
    const cold = weatherOpacity(e.time, e.windUntil, WIND_DURATION);
    const lights = lanternsIn(e);
    this.drawWaterAndLight(lights);

    drawWeather(this.weather, e.time, e.windUntil, e.rainUntil, this.options.quality?.() || "high");
    const terrainKey = e.tiles.map(t => `${t.type}:${t.row}:${t.col}`).join("|");
    if (terrainKey !== this.terrainKey) {
      this.terrainKey = terrainKey;
      const g = this.terrain;
      g.clear();
      for (const tile of e.tiles) {
        const x = this.x(tile.col),
          y = this.y(tile.row);
        if (tile.type === "grave") {
          // 墓碑：浅色石碑 + 深色描边，夜景里也能一眼看清
          g.fillStyle(0x1d2a2c, 0.35);
          g.fillEllipse(x, y + 27, 60, 16);
          g.fillStyle(0xb8c2c0);
          g.fillRoundedRect(x - 26, y - 34, 52, 66, 16);
          g.lineStyle(3, 0x5f6d70);
          g.strokeRoundedRect(x - 26, y - 34, 52, 66, 16);
          g.fillStyle(0xffffff, 0.16);
          g.fillRoundedRect(x - 20, y - 29, 14, 56, 7);
          g.lineStyle(6, 0x7e8b8c);
          g.lineBetween(x, y - 19, x, y + 11);
          g.lineBetween(x - 12, y - 8, x + 12, y - 8);
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
      this.terrainCache.clear().draw(g);
    }
    for (const tile of e.tiles) {
      if (!tile.reward) continue;
      const key = `reward-${tile.row}-${tile.col}`;
      keep.add(key);
      this.sprite(key, tile.reward, this.x(tile.col), this.y(tile.row) - 6, 32, 32, 80);
    }
    if (e.selected === "tool") {
      const source = e.plants.find(p => p.uid === e.toolSource);
      const bowl = e.bowls.find(b => b.uid === e.toolSource);
      for (let row = 0; row < e.level.rows; row++) for (let col = 0; col < 9; col++) {
        const valid = e.toolSource || e.level.mode === "whack" ? !e.toolTargetReason(row, col) :
          e.level.mode !== "bowling" && !e.movableReason(e.at(row, col, "main"));
        if (valid) {
          g.fillStyle(0xafe276, 0.10);
          g.fillRect(this.x(col) - 44, this.y(row) - 37, 88, 74);
          g.lineStyle(1, 0xd5f2aa, 0.6);
          g.strokeRect(this.x(col) - 43, this.y(row) - 36, 86, 72);
        }
      }
      if (source || bowl) {
        g.lineStyle(4, 0xffe293, 1);
        g.strokeCircle(this.x(source ? source.col : bowl!.x), this.y(source ? source.row : bowl!.row), 37);
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
        ["shooter", "lob", "homing", "shroom", "electric"].includes(plantById[p.id].kind) &&
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
      if (cold && !base) {
        const frost = cold * (0.18 + Math.sin(e.time * 5 + p.uid) * 0.06);
        g.lineStyle(2, 0xe4fbff, frost);
        g.strokeCircle(obj.x, obj.y - 43 * bodyScale, 38 * bodyScale);
        g.fillStyle(0xe4fbff, cold * 0.16);
        g.fillCircle(obj.x - 22 * bodyScale, obj.y - 66 * bodyScale, 3);
        g.fillCircle(obj.x + 23 * bodyScale, obj.y - 35 * bodyScale, 2);
      }
      if (articulatedPlants.has(p.id)) {
        const texture = this.textures.get(p.id);
        if (!texture.has("roots")) {
          texture.add("roots", 0, 0, 104, 160, 56);
          texture.add("head", 0, 0, 0, 160, 108);
        }
        const unit = 86 * bodyScale / 160;
        obj.setFrame("roots").setOrigin(0.5, 48 / 56)
          .setDisplaySize(160 * unit, 56 * unit).setAngle(0);
        const headKey = key + "head";
        keep.add(headKey);
        const head = this.sprite(headKey, p.id, obj.x, obj.y - 48 * unit,
          160 * unit, 108 * unit, obj.depth + 0.1);
        const pose = plantHeadPose(p, plantById[p.id].kind);
        head.setFrame("head").setOrigin(0.5, 104 / 108)
          .setDisplaySize(160 * unit * pose.scaleX, 108 * unit * pose.scaleY)
          .setAngle(pose.angle).setAlpha(p.sleep ? 0.65 : 1);
      }
      if (!articulatedPlants.has(p.id) && p.id !== 'chomper') {
        const pose = plantBodyPose(p);
        obj.setScale(obj.scaleX*pose.scaleX,obj.scaleY*pose.scaleY).setAngle(obj.angle+pose.angle);
      }
      const accent = plantAccent(p);
      if (accent) {
        const k = key+'accent'; keep.add(k);
        this.sprite(k,'art-'+accent.image,obj.x,feetY(p.row,e.level.rows)+accent.offsetY,
          70*accent.scale*bodyScale,70*accent.scale*bodyScale,obj.depth+.3)
          .setAlpha(accent.alpha).setAngle(accent.angle);
      }
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
      if (p.ready && p.id === "cob") {
        g.lineStyle(3, 0xffe692);
        g.strokeCircle(this.x(p.col), this.y(p.row), 36);
      }
    }
    for (const z of e.zombies) {
      const key = "z" + z.uid;
      keep.add(key);
      const scale = zombieScale(z.id);
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
      // 迷雾中未被路灯花照亮的僵尸只显示深色剪影，隐藏血条与状态图标。
      const fogged = foggedAt(e, renderRow, renderX, lights);
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
        .setAlpha(z.underground ? 0.25 : fogged ? 0.92 : 1);
      const pose = zombiePose(z);
      const extraPose = zombieVisualPose(z);
      obj.setAngle(pose.angle + extraPose.angle);
      obj.y += extraPose.offsetY;
      obj.setTint(
        fogged
          ? 0x2b3733
          : z.freeze > 0
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
      const accent = zombieAccent(z);
      if (accent && !fogged) {
        const k=key+'accent';keep.add(k);
        const frozen=accent==='iceblock', status=z.disarmed||z.ally;
        this.sprite(k,'art-'+accent,this.x(renderX),frozen?foot-35*scale:status?foot-110*scale:foot-5,
          (frozen?75:status?24:64)*scale,(frozen?90:status?24:36)*scale,obj.depth+.2)
          .setAlpha(frozen?.55:status?.7:.3+Math.sin(z.motion*.3)*.1);
      }

      if (!z.underground && !fogged) {
        const width = 45 * scale,
          left = this.x(renderX) - width / 2,
          top = obj.y - appearance.extent * scale - 7;
        const health = healthFraction(z.hp, z.max);
        g.fillStyle(0x1b2726, 0.85);
        g.fillRect(
          left - 2,
          top - 2,
          width + 4,
          z.maxArmor > 0 && z.armor > 0 ? 13 : 8,
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
        if (z.freeze > 0 || ((z.weatherSlow ?? 0) > 0 && cold > 0)) {
          g.lineStyle(2, 0xd5f6ff, z.freeze > 0 ? 0.8 : cold * 0.4);
          g.strokeEllipse(
            this.x(z.x),
            foot - 28 * scale,
            62 * scale,
            59 * scale,
          );
          if ((z.weatherSlow ?? 0) > 0 && cold && z.freeze <= 0) {
            const pulse = cold * (0.5 + Math.sin(e.time * 4 + z.uid) * 0.18);
            g.lineStyle(2, 0xc4eff5, pulse);
            g.lineBetween(this.x(z.x) - 28 * scale, foot - 47 * scale, this.x(z.x) - 14 * scale, foot - 59 * scale);
            g.lineBetween(this.x(z.x) + 25 * scale, foot - 19 * scale, this.x(z.x) + 37 * scale, foot - 32 * scale);
          }
        }
      }
    }
    for (const token of e.tokens) drawToken(g, token, e.level.rows, e.time, cold);
    for (const b of e.bowls) {
      const key = "b" + b.uid;
      keep.add(key);
      this.sprite(
        key,
        b.element ? "b-" + b.element : b.explosive ? "cherry" : "wallnut",
        this.x(b.x),
        this.y(b.row),
        75,
        82,
        70,
      ).setAngle(e.time * 300);
    }
    for (const s of e.shots) {
      if (projectileHidden(s)) continue;
      const visual = projectileVisual(s);
      const progress = Math.min(1, Math.abs(s.x - s.originX) / Math.max(0.1, Math.abs(s.destinationX - s.originX)));
      const x = this.x(s.x), y = feetY(s.row, e.level.rows) - 55 - (visual.lob ? Math.sin(progress * Math.PI) * 100 : 0);
      const target = e.zombies.find(z => z.uid === s.target);
      const direction = s.direction < 0 ? -1 : 1;
      const angle = s.type === 'cattail' && target
        ? Phaser.Math.RadToDeg(Math.atan2(this.y(target.row)-this.y(s.row), this.x(target.x)-x))
        : visual.spin ? e.time * (s.type === 'star' ? 340 : 190) : direction < 0 ? 180 : 0;
      if (this.options.quality?.() !== 'low') {
        g.fillStyle(visual.trail, .15);
        for (let i=1; i<=3; i++) g.fillCircle(x-direction*i*7,y+(visual.lob?i*2:0),Math.max(1,5-i));
      }
      const key = 'shot' + s.uid;
      keep.add(key);
      this.sprite(key, 'art-'+visual.image, x,y,visual.width,visual.height,70).setAngle(angle);
    }
    const quality = this.options.quality?.() || "high";
    const limit = quality === "low" ? 32 : quality === "medium" ? 60 : 90;
    for (let fxIndex = Math.max(0, e.effects.length - limit); fxIndex < e.effects.length; fxIndex++) {
      const fx = e.effects[fxIndex];
      if (fx.type === "mower") continue;
      const t = 1 - fx.life / fx.duration,
        x = fx.screenX ?? this.x(fx.x),
        y = fx.screenY ?? this.y(fx.row),
        key = "fx" + fx.uid;
      let frame = 15,
        size = 35,
        alpha = 1 - t;
      if (fx.type === "electric" || fx.type === "conduction") {
        const tx = this.x(fx.toX ?? fx.x), ty = this.y(fx.toRow ?? fx.row);
        const strong = fx.type === "conduction";
        g.lineStyle(strong ? 5 : 2, strong ? 0x84ecff : 0xffe590, (strong ? 1 : 0.65) * alpha);
        g.beginPath(); g.moveTo(x, y - 22);
        for (let i = 1; i <= 6; i++) {
          const fraction = i / 6;
          g.lineTo(x + (tx - x) * fraction, y - 22 + (ty - y) * fraction + (i === 6 ? 0 : (i % 2 ? 9 : -9)));
        }
        g.strokePath();
        continue;
      } else if (fx.type === "iceBreak") {
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4;
          const radius = 15 + t * 55;
          const px = x + Math.cos(angle) * radius, py = y - 22 + Math.sin(angle) * radius;
          g.fillStyle(0xc4f7ff, alpha);
          g.fillTriangle(px, py - 7, px - 4, py + 4, px + 5, py + 2);
        }
        keep.add(key);
        let label = this.objects.get(key) as Phaser.GameObjects.Text;
        if (!label) { label = this.add.text(x, y - 65, "冰电爆发", { fontSize: "18px", color: "#eaffff", stroke: "#26556c", strokeThickness: 4 }).setOrigin(0.5).setDepth(102); this.objects.set(key, label); }
        label.setPosition(x, y - 65 - t * 18).setAlpha(alpha);
        continue;
      }
      if (fx.type === "dust") {
        // 墓碑破土：三团尘土向上散开
        for (let i = 0; i < 3; i++) {
          const angle = -Math.PI / 2 + (i - 1) * 0.7,
            radius = 6 + t * 26;
          g.fillStyle(0x9a8f7a, alpha * 0.85);
          g.fillCircle(
            x + Math.cos(angle) * radius,
            y - 10 + Math.sin(angle) * radius,
            7 + t * 5,
          );
        }
        continue;
      }
      if (['magnet', 'wind', 'splash'].includes(fx.type)) {
        keep.add(key);
        const wind = fx.type === 'wind';
        const size = fx.type === 'magnet' ? 64 : wind ? 125 : 90;
        this.sprite(key, 'art-' + fx.type, x + (wind ? t*85 : 0),
          feetY(fx.row,e.level.rows) - (fx.type === 'splash' ? 10 : 45),
          size*(.7+t*.5),size*(.7+t*.5),72)
          .setAlpha(Math.sin(Math.PI*t)*.9);
        continue;
      }
      if (fx.type === 'shoot') {
        const visual=projectileVisual({type:fx.source??'pea'});
        if(t<.5) {
          keep.add(key);
          this.sprite(key,visual.image==='spore'?'art-spore':'art-impact',
            this.x(fx.x + (fx.direction ?? 1)*0.35),feetY(fx.row,e.level.rows)-55,
            visual.image==='spore'?26:16,visual.image==='spore'?22:16,72)
            .setTint(visual.trail).setFlipX((fx.direction ?? 1)<0).setAlpha((1-t*2)*.65);
        }
        continue;
      }

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
        if (fx.type === "collect" && fx.source === "coin") {
          g.lineStyle(2, 0xffe39a, alpha);
          g.strokeCircle(x, y, 12 + t * 25);
          for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4;
            g.fillStyle(0xffe7a4, alpha);
            g.fillCircle(x + Math.cos(a) * t * 30, y + Math.sin(a) * t * 30, 2);
          }
          continue;
        }
      } else if (fx.type === "spore") {
        frame = 9;
        size = 170;
      } else if (fx.type === "fly") {
        // Sun/coin icon accelerating toward the seed-tray corner.
        const ease = t * t;
        const target = this.options.pickupTarget?.(fx.source === "coin") ?? { x: fx.source === "coin" ? 145 : 60, y: 0 };
        const flyX = x + (target.x - x) * ease,
          flyY = y + (target.y - y) * ease - Math.sin(Math.PI * t) * 46;
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
          const scale = zombieScale(z.id);
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
            .setAngle(zombiePose(z).angle + t * 78 * (z.reverse ? -1 : 1))
            .setAlpha(1 - t);
        } else
          this.sprite(key, "z-" + fx.source, x, y + 15, 78, 98, 65)
            .setAngle(t * 70)
            .setAlpha(1 - t);
        continue;
      } else if (fx.type === "shoot") {
        frame = 15;
        size = 23;
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
    const drawMower = (key: string, x: number, row: number, spare = false, moving = false) => {
      keep.add(key);
      const size = spare ? 57 : 82;
      this.sprite(key, "mower", x, feetY(row, e.level.rows) - (spare ? 30 : 0),
        size, size * 0.75, 81)
        .setFrame(moving ? Math.floor(e.time * 28) % 4 : 0)
        .setDisplaySize(size, size * 0.75)
        .setOrigin(0.5, 89 / 96)
        .setAlpha(spare ? 0.72 : 1);
    };
    for (let r = 0; r < e.level.rows; r++) {
      if (e.spareMowers[r]) drawMower("mower-spare-" + r, BOARD.mowerX - 8, r, true);
      if (e.mowers[r]) drawMower("mower-ready-" + r, BOARD.mowerX, r);
    }
    // Safety feedback must survive the cosmetic effect budget on crowded waves.
    for (const fx of e.effects) {
      if (fx.type !== "mower") continue;
      const progress = 1 - fx.life / fx.duration;
      const x = BOARD.mowerX + (BOARD.width + 60 - BOARD.mowerX) * progress * progress;
      drawMower("mower-run-" + fx.uid, x, fx.row, false, true);
    }
    if (e.level.mode === "boss") {
      const key = "boss";
      keep.add(key);
      this.sprite(key, "z-boss", 1130, 320, 140, 180, 60).setAlpha(
        e.bossDown > 0 ? 1 : 0.5,
      );
      if (e.bossBall) {
        keep.add('boss-ball');
        this.sprite('boss-ball',e.bossBall.type === 'fire' ? 'art-fire' : 'art-snowball',
          this.x(e.bossBall.x),this.y(e.bossBall.row),86,72, 70).setAngle(e.bossBall.type === 'fire' ? 180 : e.time*100);
      }
    }
    for (const [k, obj] of this.objects)
      if (!keep.has(k)) {
        obj.destroy();
        this.objects.delete(k);
        if (k.startsWith("z")) this.previous.delete(Number(k.slice(1)));
      }
    // A zombie may spawn and die between renders, without ever owning a sprite.
    for (const uid of this.previous.keys())
      if (!keep.has("z" + uid)) this.previous.delete(uid);
    this.mist.update(e, this.options.quality?.() || "high");
  }
  drawWaterAndLight(lights: ReturnType<typeof lanternsIn>) {
    const g = this.waterSurface, e = this.engine;
    g.clear();
    if (e.level.scene !== "fog" && e.level.scene !== "pool") return;
    const top = BOARD.top + BOARD.lawnHeight / 3;
    const h = BOARD.lawnHeight / 3, width = BOARD.cell * 9;
    const night = e.level.scene === "fog";
    g.fillStyle(night ? 0x4a939f : 0x8bdded, night ? .12 : .04);
    g.fillRect(BOARD.left, top, width, h);
    g.lineStyle(2, night ? 0x9bc4c6 : 0xd0f3e8, .38);
    g.lineBetween(BOARD.left, top, BOARD.left + width, top);
    g.lineBetween(BOARD.left, top + h, BOARD.left + width, top + h);
    const count = this.options.quality?.() === "low" ? 6 : 18;
    for (let i = 0; i < count; i++) {
      const x = BOARD.left + 24 + ((i * 137 + e.time * 8) % (width - 70));
      const y = top + 22 + (i * 47) % (h - 44) + Math.sin(e.time + i) * 3;
      g.lineStyle(1, 0xbbe2de, .12 + Math.sin(e.time * .6 + i) * .06);
      g.lineBetween(x, y, x + 30, y - 2);
    }
    for (const light of lights) {
      for (let ring = 4; ring > 0; ring--) {
        g.fillStyle(0xffd989, .018 * (5 - ring));
        g.fillEllipse(this.x(light.col), this.y(light.row), ring * 52, ring * 32);
      }
    }
  }
}
