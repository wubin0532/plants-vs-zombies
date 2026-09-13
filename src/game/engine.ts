import { plantSound, type SoundEvent, type SoundKind } from "./audio";
import {
  battleSettings,
  makeWaves,
  type BattleOptions,
  type SpawnEvent,
} from "./difficulty";
import {
  levels,
  plantById,
  zombieById,
  isMushroom,
  isNight,
  type Level,
} from "./content";
export type Plant = {
  uid: number;
  id: string;
  row: number;
  col: number;
  hp: number;
  max: number;
  timer: number;
  age: number;
  sleep: boolean;
  ready: boolean;
  layer: "base" | "main" | "armor";
  ladder?: boolean;
};
export type Zombie = {
  uid: number;
  id: string;
  row: number;
  x: number;
  hp: number;
  max: number;
  armor: number;
  slow: number;
  freeze: number;
  timer: number;
  age: number;
  jumped: boolean;
  underground: boolean;
  flying: boolean;
  reverse: boolean;
  ally: boolean;
  thrown: boolean;
  maxArmor: number;
  motion: number;
  action: "walk" | "eat" | "jump" | "special";
  jump?: { from: number; to: number; elapsed: number; duration: number };
};
export type Shot = {
  uid: number;
  x: number;
  row: number;
  target: number;
  damage: number;
  speed: number;
  type: string;
  hit: boolean;
};
export type Token = {
  uid: number;
  x: number;
  row: number;
  value: number;
  age: number;
  coin: boolean;
};
export type Effect = {
  uid: number;
  x: number;
  row: number;
  type: string;
  life: number;
  duration: number;
  source?: string;
};
export type Tile = {
  row: number;
  col: number;
  type: "grave" | "crater" | "ice" | "vase";
  life: number;
};
export class Engine {
  level: Level;
  settings: ReturnType<typeof battleSettings>;
  schedule: SpawnEvent[];
  sounds: SoundEvent[] = [];
  wave = 0;
  get totalWaves() {
    return this.schedule.at(-1)?.wave || 1;
  }
  get nextWaveIn() {
    return Math.max(
      0,
      (this.schedule.find((event) => event.wave > this.wave)?.at ??
        this.settings.duration) - this.time,
    );
  }
  sound(kind: SoundKind, x = 4, source?: string) {
    if (this.sounds.length < 96) this.sounds.push({ kind, x, source });
  }
  drainSounds() {
    return this.sounds.splice(0);
  }
  plants: Plant[] = [];
  zombies: Zombie[] = [];
  shots: Shot[] = [];
  tokens: Token[] = [];
  effects: Effect[] = [];
  tiles: Tile[] = [];
  mowers: boolean[];
  sun = 150;
  coins = 0;
  time = 0;
  spawned = 0;
  kills = 0;
  status: "playing" | "won" | "lost" = "playing";
  paused = false;
  cooldowns: Record<string, number> = {};
  selected = "";
  message = "选择种子，再点击草坪种植";
  messageUntil = 6;
  cards: string[];
  conveyor: string[] = [];
  fogClear = 0;
  bossHp = 24000;
  bossMax = 24000;
  bossDown = 0;
  bossTimer = 12;
  bossBall: { row: number; x: number; type: "fire" | "ice" } | null = null;
  imitate = "pea";
  cannon = 0;
  bowls: {
    uid: number;
    x: number;
    row: number;
    explosive: boolean;
    hit: number[];
  }[] = [];
  private uid = 1;
  private rng: number;
  private natural = 4;
  private nextSpawn = 22;
  private beltTimer = 0;
  constructor(
    id: number,
    cards: string[],
    seed = id * 719,
    options: Partial<BattleOptions> = {},
  ) {
    this.level = { ...levels[id - 1] };
    if (!levels[id - 1]) throw Error("无效关卡");
    this.settings = battleSettings(this.level, options);
    this.schedule = makeWaves(this.level, this.settings);
    if (this.schedule.length) this.level.count = this.schedule.length;
    this.sun = this.settings.sun;
    this.bossHp = this.bossMax = 24000 * this.settings.health;
    this.cards = cards;
    this.rng = seed || 1;
    this.mowers = Array(this.level.rows).fill(this.settings.mowers);
    if (this.level.scene === "night")
      for (let i = 0; i < Math.min(2 + this.level.stage, 8); i++)
        this.tiles.push({
          row: i % 5,
          col: 5 + Math.floor(i / 5),
          type: "grave",
          life: Infinity,
        });
    if (this.level.scene === "roof")
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 3; c++) this.addPlant("pot", r, c);
    if (this.level.mode === "vases") {
      this.nextSpawn = Infinity;
      for (let r = 0; r < 6; r++)
        for (let c = 4; c < 8; c++)
          this.tiles.push({ row: r, col: c, type: "vase", life: Infinity });
      this.say("点击罐子：里面可能藏着种子，也可能是僵尸！");
    }
    if (this.level.mode === "whack") {
      this.nextSpawn = 2;
      this.say("点击僵尸，用锤子保卫庭院！");
    }
    if (this.isBelt) {
      this.sun = 0;
      this.addBelt();
      this.addBelt();
      this.addBelt();
    }
  }
  get isBelt() {
    return ["conveyor", "bowling", "storm", "boss", "vases"].includes(
      this.level.mode,
    );
  }
  random() {
    this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
  say(s: string) {
    this.message = s;
    this.messageUntil = this.time + 4;
  }
  effect(x: number, row: number, type: string, source?: string) {
    const duration =
      type === "boom"
        ? 1.4
        : type === "ice"
          ? 1.2
          : type === "death"
            ? 0.8
            : type === "collect"
              ? 0.7
              : 0.45;
    const sound: Partial<Record<string, SoundKind>> = {
      boom: "explosion",
      ice: "freeze",
      bite: "bite",
      plant: "plant",
      sun: "sun",
      collect: "sun",
      death: "death",
      mower: "mower",
      jump: "jump",
      shovel: "shovel",
    };
    if (sound[type]) this.sound(sound[type]!, x, source);
    this.effects.push({
      uid: this.uid++,
      x,
      row,
      type,
      life: duration,
      duration,
      source,
    });
  }
  getDef(id: string) {
    return plantById[id === "imitater" ? this.imitate : id];
  }
  water(row: number) {
    return (
      ["pool", "fog"].includes(this.level.scene) && (row === 2 || row === 3)
    );
  }
  at(row: number, col: number, layer?: Plant["layer"]) {
    return this.plants.find(
      (p) => p.row === row && p.col === col && (!layer || p.layer === layer),
    );
  }
  addPlant(id: string, row: number, col: number) {
    const d = plantById[id];
    const plant: Plant = {
      uid: this.uid++,
      id,
      row,
      col,
      hp: d.hp,
      max: d.hp,
      timer: d.kind === "sun" ? 7 : 0.7,
      age: 0,
      sleep:
        isMushroom(id) &&
        !isNight(this.level.scene) &&
        this.level.mode !== "boss",
      ready: false,
      layer: d.kind === "base" ? "base" : d.kind === "armor" ? "armor" : "main",
    };
    this.plants.push(plant);
    return plant;
  }
  canPlant(id: string, row: number, col: number): string {
    const d = this.getDef(id);
    if (!d) return "请先选择种子";
    if (row < 0 || row >= this.level.rows || col < 0 || col > 8)
      return "请选择草坪内的位置";
    const tile = this.tiles.find((t) => t.row === row && t.col === col);
    if (tile && !(tile.type === "grave" && d.id === "grave"))
      return tile.type === "grave"
        ? "这里有墓碑，需要墓碑吞噬者"
        : "这里暂时不能种植";
    const main = this.at(row, col, "main"),
      base = this.at(row, col, "base");
    if (d.id === "grave") return tile?.type === "grave" ? "" : "只能种在墓碑上";
    if (d.id === "coffee") return main?.sleep ? "" : "请选择一株睡着的蘑菇";
    if (d.upgrade) {
      if (
        d.id === "cob" &&
        (col === 8 || this.at(row, col + 1, "main")?.id !== "kernel")
      )
        return "需要横向相邻的两株玉米投手";
      return main?.id === d.upgrade || (base?.id === d.upgrade && !main)
        ? ""
        : "需要种在对应的基础植物上";
    }
    if (d.id === "lily")
      return !this.water(row)
        ? "睡莲只能种在水上"
        : base
          ? "这里已经有睡莲"
          : "";
    if (d.id === "pot")
      return this.water(row)
        ? "花盆不能种在水上"
        : base || main
          ? "这里已经有植物"
          : "";
    if (d.id === "sea" || d.id === "kelp")
      return !this.water(row)
        ? "这种植物只能种在水上"
        : main
          ? "这里已经有植物"
          : "";
    if (this.water(row) && !base) return "水路需要先放一片睡莲";
    if (this.level.scene === "roof" && !base) return "屋顶需要先放一个花盆";
    if (d.kind === "armor")
      return this.at(row, col, "armor") ? "这里已经有南瓜头" : "";
    return main ? "这里已经有植物" : "";
  }
  plant(id: string, row: number, col: number) {
    if (this.status !== "playing" || this.paused) return false;
    const d = this.getDef(id);
    const reason = this.canPlant(id, row, col);
    if (reason) {
      this.say(reason);
      return false;
    }
    const belt = this.isBelt;
    const index = this.conveyor.indexOf(id);
    if (belt && index < 0) {
      this.say("等待新的种子到来");
      return false;
    }
    if (!belt && (this.cooldowns[id] > 0 || this.sun < d.cost)) {
      this.say(
        this.cooldowns[id] > 0 ? "种子还在冷却" : "阳光不足，先收集阳光",
      );
      return false;
    }
    if (belt) this.conveyor.splice(index, 1);
    else {
      this.sun -= d.cost;
      this.cooldowns[id] = d.cooldown;
    }
    if (this.level.mode === "bowling") {
      this.bowls.push({
        uid: this.uid++,
        x: col,
        row,
        explosive: d.id === "cherry",
        hit: [],
      });
      return true;
    }
    if (d.id === "coffee") {
      this.at(row, col, "main")!.sleep = false;
      this.effect(col, row, "sun");
      return true;
    }
    if (d.upgrade) {
      const old = this.plants.find(
        (p) => p.row === row && p.col === col && p.id === d.upgrade,
      );
      if (old) this.remove(old);
      if (d.id === "cob") {
        const second = this.at(row, col + 1, "main");
        if (second) this.remove(second);
        const blocker = this.addPlant("kernel", row, col + 1);
        blocker.id = "cob";
        blocker.ready = false;
        blocker.timer = Infinity;
      }
    }
    const p = this.addPlant(d.id, row, col);
    if (d.id === "cob") p.timer = 8;
    this.effect(col, row, "plant");
    return true;
  }
  remove(p: Plant) {
    this.plants = this.plants.filter((q) => q.uid !== p.uid);
    if (p.layer === "base")
      this.plants = this.plants.filter(
        (q) => q.row !== p.row || q.col !== p.col,
      );
  }
  shovel(row: number, col: number) {
    if (this.paused || this.status !== "playing") return;
    const p =
      this.at(row, col, "armor") ||
      this.at(row, col, "main") ||
      this.at(row, col, "base");
    if (p) {
      if (p.id === "cob") {
        const neighbor = this.plants.find(
          (q) => q.id === "cob" && q.row === row && Math.abs(q.col - col) === 1,
        );
        if (neighbor) this.remove(neighbor);
      }
      this.remove(p);
      this.effect(col, row, "plant");
    }
  }
  collect(uid: number) {
    if (this.paused || this.status !== "playing") return;
    const t = this.tokens.find((t) => t.uid === uid);
    if (!t) return;
    if (t.coin) this.coins += t.value;
    else this.sun += t.value;
    this.effect(t.x, t.row, "collect");
    this.tokens = this.tokens.filter((t) => t.uid !== uid);
  }
  token(x: number, row: number, value = 25, coin = false) {
    this.tokens.push({ uid: this.uid++, x, row, value, coin, age: 0 });
  }
  addBelt() {
    if (this.conveyor.length >= 9) return;
    let pool = this.cards.filter(
      (id) =>
        ![
          "sunflower",
          "sunshroom",
          "twin",
          "marigold",
          "goldmagnet",
          "imitater",
          "coffee",
          "grave",
        ].includes(id),
    );
    if (this.level.mode === "bowling") pool = ["wallnut", "wallnut", "cherry"];
    if (this.level.mode === "boss")
      pool = ["cabbage", "kernel", "melon", "ice", "jalapeno", "pot"];
    if (this.level.scene === "roof" && this.random() < 0.3) pool = ["pot"];
    if (this.water(2) && this.random() < 0.25) pool = ["lily"];
    this.conveyor.push(pool[Math.floor(this.random() * pool.length)] || "pea");
  }
  spawn(id: string, row?: number, x = 9.6) {
    const d = zombieById[id];
    if (!d) return;
    let r = row ?? Math.floor(this.random() * this.level.rows);
    const aquatic = ["ducky", "snorkel", "dolphin"].includes(id);
    if (aquatic) r = 2 + Math.floor(this.random() * 2);
    else if (
      row === undefined &&
      this.water(r) &&
      !["balloon", "bungee"].includes(id)
    )
      r = [0, 1, 4, 5][Math.floor(this.random() * 4)];
    if (id === "bungee") x = 1 + Math.floor(this.random() * 7);
    this.sound("groan", x, id);
    this.zombies.push({
      uid: this.uid++,
      id,
      row: r,
      x,
      hp: (this.level.id === 25 ? d.hp * 0.4 : d.hp) * this.settings.health,
      max: (this.level.id === 25 ? d.hp * 0.4 : d.hp) * this.settings.health,
      armor:
        (this.level.id === 25 ? d.armor * 0.4 : d.armor) * this.settings.health,
      maxArmor:
        (this.level.id === 25 ? d.armor * 0.4 : d.armor) * this.settings.health,
      motion: 0,
      action: "walk",
      slow: 0,
      freeze: 0,
      timer: 0,
      age: 0,
      jumped: false,
      underground: id === "digger",
      flying: id === "balloon",
      reverse: false,
      ally: false,
      thrown: false,
    });
  }
  damage(z: Zombie, amount: number, pierce = false) {
    if (z.hp <= 0) return;
    this.sound(z.armor > 0 && !pierce ? "metal" : "hit", z.x, z.id);
    let rest = amount;
    if (z.armor > 0 && !pierce) {
      const used = Math.min(z.armor, rest);
      z.armor -= used;
      rest -= used;
    }
    z.hp -= rest;
    this.effect(z.x, z.row, "hit");
  }
  blast(
    x: number,
    row: number,
    radius = 1.5,
    damage = 1800,
    source = "cherry",
  ) {
    this.effect(x, row, "boom", source);
    for (const z of this.zombies)
      if (
        Math.abs(z.row - row) <= radius &&
        Math.abs(z.x - x) <= radius &&
        !z.ally
      )
        this.damage(z, damage, true);
    if (this.level.mode === "boss" && this.bossDown > 0)
      this.bossHp -= damage * 0.35;
  }
  click(row: number, col: number) {
    if (this.paused || this.status !== "playing") return;
    if (this.cannon) {
      const p = this.plants.find((p) => p.uid === this.cannon);
      if (p) {
        this.blast(col, row, 1.6, 1800, "cob");
        p.ready = false;
        p.timer = 35;
      }
      this.cannon = 0;
      return;
    }
    if (this.selected === "shovel") {
      this.shovel(row, col);
      return;
    }
    const vase = this.tiles.find(
      (t) => t.row === row && t.col === col && t.type === "vase",
    );
    if (vase) {
      this.tiles = this.tiles.filter((t) => t !== vase);
      this.effect(col, row, "plant");
      if (this.random() < 0.4)
        this.spawn(this.random() < 0.2 ? "bucket" : "basic", row, col);
      else
        this.conveyor.push(
          this.water(row)
            ? "kelp"
            : ["pea", "snowpea", "squash"][Math.floor(this.random() * 3)],
        );
      return;
    }
    const cannon = this.at(row, col, "main");
    if (cannon?.id === "cob" && cannon.ready) {
      this.cannon = cannon.uid;
      this.say("点击目标区域发射玉米炮");
      return;
    }
    if (this.selected && this.plant(this.selected, row, col) && this.isBelt)
      this.selected = "";
  }
  hitZombie(uid: number) {
    if (this.level.mode !== "whack" || this.paused || this.status !== "playing")
      return;
    const z = this.zombies.find((z) => z.uid === uid);
    if (z) this.damage(z, 200, true);
  }
  shoot(p: Plant, z: Zombie, damage: number, type = p.id) {
    this.shots.push({
      uid: this.uid++,
      x: p.col + 0.35,
      row: p.row,
      target: z.uid,
      damage,
      speed: ["lob", "homing"].includes(plantById[p.id].kind) ? 4 : 6,
      type,
      hit: false,
    });
    this.effect(p.col, p.row, "shoot", p.id);
    this.sound(plantSound(p.id), p.col, p.id);
  }
  protected(row: number, x: number) {
    return this.plants.some(
      (p) =>
        p.id === "umbrella" &&
        Math.abs(p.row - row) <= 1 &&
        Math.abs(p.col - x) <= 1,
    );
  }
  step(dt: number) {
    if (this.paused || this.status !== "playing") return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.fogClear = Math.max(0, this.fogClear - dt);
    this.bossDown = Math.max(0, this.bossDown - dt);
    for (const id in this.cooldowns)
      this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    this.effects.forEach((e) => (e.life -= dt));
    this.effects = this.effects.filter((e) => e.life > 0);
    this.tokens.forEach((t) => (t.age += dt));
    this.tokens = this.tokens.filter((t) => t.age < 16);
    this.tiles.forEach((t) => (t.life -= dt));
    this.tiles = this.tiles.filter((t) => t.life > 0);
    if (!this.isBelt && !isNight(this.level.scene)) {
      this.natural -= dt;
      if (this.natural <= 0) {
        this.token(
          0.4 + this.random() * 7.8,
          this.random() * (this.level.rows - 1),
        );
        this.natural = 6;
      }
    }
    if (this.isBelt) {
      this.beltTimer -= dt;
      if (this.beltTimer <= 0) {
        this.addBelt();
        this.beltTimer = 4;
      }
    }
    while (
      this.spawned < this.schedule.length &&
      this.time >= this.schedule[this.spawned].at
    ) {
      const event = this.schedule[this.spawned++];
      if (event.wave !== this.wave) {
        this.wave = event.wave;
        if (event.wave % 4 === 0 || event.wave === this.totalWaves)
          this.say("一大波僵尸正在接近！");
      }
      this.spawn(
        event.id,
        undefined,
        this.level.mode === "whack" ? 4 + this.random() * 4 : 9.6,
      );
      if (this.spawned === this.schedule.length && this.level.scene === "night")
        for (const tile of this.tiles)
          if (tile.type === "grave") this.spawn("basic", tile.row, tile.col);
    }
    if (this.level.mode === "boss") this.updateBoss(dt);
    for (const p of [...this.plants]) {
      if (p.hp <= 0) continue;
      p.age += dt;
      if (p.sleep) continue;
      p.timer -= dt;
      const d = plantById[p.id];
      const targets = this.zombies.filter(
        (z) => z.hp > 0 && !z.ally && !z.underground,
      );
      const ahead = targets
        .filter(
          (z) =>
            z.row === p.row &&
            z.x > p.col - 0.2 &&
            (!z.flying || ["cactus", "cattail"].includes(p.id)) &&
            (z.id !== "snorkel" || z.x < p.col + 0.65 || d.kind === "lob"),
        )
        .sort((a, b) => a.x - b.x);
      if (d.kind === "sun" && p.timer <= 0) {
        this.token(
          p.col,
          p.row,
          p.id === "sunshroom" && p.age < 120 ? 15 : p.id === "twin" ? 50 : 25,
        );
        p.timer = 24;
      }
      if (d.kind === "coin" && p.timer <= 0) {
        if (p.id === "goldmagnet") {
          for (const t of [...this.tokens]) if (t.coin) this.collect(t.uid);
        } else this.token(p.col, p.row, 10, true);
        p.timer = 24;
      }
      if (
        ["bomb", "doom", "ice", "jalapeno", "blover", "grave"].includes(
          d.kind,
        ) &&
        p.age > 1
      ) {
        if (d.kind === "bomb" || d.kind === "doom") {
          this.blast(p.col, p.row, d.kind === "doom" ? 2.5 : 1.5, 1800, p.id);
          if (d.kind === "doom")
            this.tiles.push({
              row: p.row,
              col: p.col,
              type: "crater",
              life: 90,
            });
        }
        if (d.kind === "ice") {
          for (const z of targets) {
            z.freeze = 4;
            z.slow = 15;
          }
          this.effect(p.col, p.row, "ice", p.id);
          if (this.bossBall?.type === "fire") this.bossBall = null;
        }
        if (d.kind === "jalapeno") {
          for (const z of targets)
            if (z.row === p.row) this.damage(z, 1800, true);
          this.tiles = this.tiles.filter(
            (t) => !(t.type === "ice" && t.row === p.row),
          );
          for (let c = 0; c < 9; c++) this.effect(c, p.row, "boom", "jalapeno");
          if (this.bossBall?.type === "ice" && this.bossBall.row === p.row)
            this.bossBall = null;
        }
        if (d.kind === "blover") {
          for (const z of targets) if (z.flying) z.hp = 0;
          this.fogClear = 20;
          this.effect(p.col, p.row, "ice", p.id);
        }
        if (d.kind === "grave")
          this.tiles = this.tiles.filter(
            (t) => !(t.row === p.row && t.col === p.col),
          );
        this.remove(p);
        continue;
      }
      if (d.kind === "mine") {
        p.ready = p.age >= 14;
        if (p.ready && ahead.some((z) => Math.abs(z.x - p.col) < 0.4)) {
          this.blast(p.col, p.row, 0.55, 1800, "potato");
          this.remove(p);
        }
      }
      if (
        ["squash", "kelp", "chomp"].includes(d.kind) &&
        p.timer <= 0 &&
        ahead.some((z) => z.x < p.col + 1)
      ) {
        const z = ahead[0];
        this.damage(z, 1800, true);
        this.effect(p.col, p.row, "boom");
        if (d.kind === "chomp") p.timer = 35;
        else this.remove(p);
      }
      if (d.kind === "spike" && p.timer <= 0) {
        for (const z of targets)
          if (z.row === p.row && Math.abs(z.x - p.col) < 0.6 && !z.flying) {
            this.damage(z, d.damage!, true);
            if (["zomboni", "catapult"].includes(z.id)) {
              z.hp = 0;
              p.hp -= 300;
              if (p.id === "spike") p.hp = 0;
            }
          }
        p.timer = 1;
      }
      if (d.kind === "magnet" && p.timer <= 0) {
        const z = targets.find(
          (z) =>
            Math.abs(z.x - p.col) < 3 &&
            Math.abs(z.row - p.row) < 2 &&
            ((["bucket", "screen", "football"].includes(z.id) && z.armor > 0) ||
              (["pogo", "digger", "ladder"].includes(z.id) && !z.jumped)),
        );
        if (z) {
          z.armor = 0;
          z.jumped = true;
          z.underground = false;
          p.timer = 12;
          this.effect(z.x, z.row, "ice");
        }
      }
      if (d.kind === "cannon" && p.timer <= 0) p.ready = true;
      if (
        p.timer <= 0 &&
        [
          "shooter",
          "shroom",
          "lob",
          "homing",
          "fume",
          "gloom",
          "star",
        ].includes(d.kind)
      ) {
        let fired = false;
        if (d.kind === "fume" || d.kind === "gloom") {
          const group = targets.filter(
            (z) =>
              !z.flying &&
              Math.abs(z.row - p.row) < (d.kind === "gloom" ? 2 : 1) &&
              (d.kind === "gloom"
                ? Math.abs(z.x - p.col) < 1.5
                : z.x >= p.col && z.x < p.col + 4),
          );
          for (const z of group) {
            this.damage(z, d.damage!, true);
            fired = true;
          }
        } else if (d.kind === "star") {
          for (const z of targets.filter(
            (z) =>
              Math.abs(z.x - p.col) < 3 &&
              Math.abs(z.row - p.row) <= 2 &&
              !z.flying,
          )) {
            this.shoot(p, z, d.damage!);
            fired = true;
          }
        } else if (d.kind === "homing") {
          if (targets[0]) {
            this.shoot(p, targets[0], d.damage!);
            fired = true;
          }
        } else {
          let lanes =
            p.id === "three" ? [p.row - 1, p.row, p.row + 1] : [p.row];
          for (const lane of lanes) {
            let z =
              lane === p.row
                ? ahead[0]
                : targets.find(
                    (z) => z.row === lane && z.x > p.col && !z.flying,
                  );
            if (p.id === "split")
              z = targets.find((z) => z.row === p.row && !z.flying);
            if (z) {
              if (d.kind === "shroom" && p.id !== "scaredy" && z.x - p.col > 3)
                continue;
              if (
                p.id === "scaredy" &&
                targets.some(
                  (z) =>
                    Math.abs(z.x - p.col) < 1 && Math.abs(z.row - p.row) <= 1,
                )
              )
                continue;
              if (
                this.level.scene === "roof" &&
                p.col < 4 &&
                d.kind !== "lob" &&
                z.x > 4
              )
                continue;
              this.shoot({ ...p, row: lane }, z, d.damage!);
              fired = true;
            }
          }
          if (
            this.level.mode === "boss" &&
            this.bossDown > 0 &&
            d.kind === "lob" &&
            !ahead.length
          ) {
            this.bossHp -= d.damage!;
            fired = true;
            this.effect(9, p.row, "hit");
          }
        }
        if (fired) {
          p.timer = d.interval || 1.4;
          if (["fume", "gloom"].includes(d.kind)) {
            this.sound("spore", p.col, p.id);
            this.effect(p.col + 1, p.row, "spore", p.id);
          }
        }
      }
    }
    for (const s of this.shots) {
      const z = this.zombies.find((z) => z.uid === s.target && z.hp > 0);
      if (!z) {
        s.hit = true;
        continue;
      }
      const direction = z.x >= s.x ? 1 : -1;
      s.x += direction * s.speed * dt;
      if (
        ["cattail", "star", "cabbage", "kernel", "melon", "winter"].includes(
          s.type,
        )
      )
        s.row += (z.row - s.row) * Math.min(1, dt * 9);
      const torch = this.plants.find(
        (p) =>
          p.id === "torch" && p.row === s.row && Math.abs(p.col - s.x) < 0.15,
      );
      if (
        torch &&
        ["pea", "repeater", "three", "gatling", "split"].includes(s.type)
      ) {
        s.damage *= 2;
        s.type = "fire";
      }
      if (Math.abs(s.x - z.x) < 0.18) {
        s.hit = true;
        this.damage(
          z,
          s.damage,
          z.id === "screen" &&
            ["cabbage", "kernel", "melon", "winter"].includes(s.type),
        );
        if (["snowpea", "winter"].includes(s.type)) z.slow = 10;
        if (s.type === "kernel" && this.random() < 0.25) z.freeze = 3;
        if (s.type === "cactus" || s.type === "cattail") z.flying = false;
        if (["melon", "winter", "fire"].includes(s.type))
          for (const other of this.zombies)
            if (
              other.uid !== z.uid &&
              !other.ally &&
              Math.abs(other.x - z.x) < 1 &&
              Math.abs(other.row - z.row) <= 1
            ) {
              this.damage(other, s.damage / 3);
              if (s.type === "winter") other.slow = 10;
            }
      }
    }
    this.shots = this.shots.filter((s) => !s.hit);
    for (const b of this.bowls) {
      b.x += dt * 3.4;
      const z = this.zombies.find(
        (z) =>
          !z.ally &&
          z.hp > 0 &&
          z.row === b.row &&
          Math.abs(z.x - b.x) < 0.35 &&
          !b.hit.includes(z.uid),
      );
      if (z) {
        b.hit.push(z.uid);
        if (b.explosive) {
          this.blast(b.x, b.row, 1.5);
          b.x = 12;
        } else {
          this.damage(z, 550);
          const rows = [b.row - 1, b.row + 1].filter(
            (r) => r >= 0 && r < this.level.rows,
          );
          b.row = rows[Math.floor(this.random() * rows.length)];
        }
      }
    }
    this.bowls = this.bowls.filter((b) => b.x < 10.5);

    for (const z of [...this.zombies]) this.updateZombie(z, dt);
    const dead = this.zombies.filter((z) => z.hp <= 0);
    this.kills += dead.filter((z) => !z.ally).length;
    for (const z of dead) {
      this.effect(z.x, z.row, "death", z.id);
      if (this.random() < 0.1) this.token(z.x, z.row, 10, true);
    }
    this.zombies = this.zombies.filter((z) => z.hp > 0 && z.x > -2 && z.x < 12);
    this.plants = this.plants.filter((p) => p.hp > 0);
    if (
      this.status === "playing" &&
      ((this.level.mode === "boss" && this.bossHp <= 0) ||
        (this.level.mode === "vases" &&
          !this.tiles.some((t) => t.type === "vase") &&
          !this.zombies.some((z) => !z.ally)) ||
        (!["boss", "vases"].includes(this.level.mode) &&
          this.spawned >= this.level.count &&
          !this.zombies.some((z) => !z.ally)))
    ) {
      this.status = "won";
      this.say("庭院守住了！");
    }
  }
  updateZombie(z: Zombie, dt: number) {
    if (z.hp <= 0) return;
    const d = zombieById[z.id];
    z.age += dt;
    z.timer -= dt;
    z.slow = Math.max(0, z.slow - dt);
    z.freeze = Math.max(0, z.freeze - dt);
    if (z.freeze > 0) return;
    z.action = "walk";
    if (z.jump) {
      z.action = "jump";
      z.jump.elapsed = Math.min(z.jump.duration, z.jump.elapsed + dt);
      const progress = z.jump.elapsed / z.jump.duration;
      z.x = z.jump.from + (z.jump.to - z.jump.from) * progress;
      if (progress >= 1) {
        z.jump = undefined;
        z.action = "walk";
        this.effect(z.x, z.row, "land");
      }
      return;
    }
    if (Math.floor((z.age - dt) / 8) !== Math.floor(z.age / 8))
      this.sound("groan", z.x, z.id);
    if (z.id === "bungee") {
      z.action = "special";
      if (z.age > 5) {
        const p = this.at(z.row, Math.round(z.x), "main");
        if (p && !this.protected(z.row, z.x)) this.remove(p);
        z.hp = 0;
      }
      return;
    }
    if (z.id === "jack" && z.age > 15 && this.random() < dt * 0.2) {
      for (const p of [...this.plants])
        if (Math.abs(p.row - z.row) <= 1 && Math.abs(p.col - z.x) < 1.5)
          this.remove(p);
      this.effect(z.x, z.row, "boom");
      z.hp = 0;
      return;
    }
    if (z.id === "dancer" && z.timer <= 0) {
      for (const row of [z.row - 1, z.row + 1])
        if (row >= 0 && row < this.level.rows) this.spawn("backup", row, z.x);
      z.timer = 18;
    }
    if (["garg"].includes(z.id) && z.hp < z.max / 2 && !z.thrown) {
      this.spawn("imp", z.row, Math.max(0, z.x - 4));
      z.thrown = true;
    }
    if (z.id === "catapult" && z.x > 7 && z.age < 30) {
      z.action = "special";
      if (z.timer <= 0) {
        const p = this.plants.find(
          (p) => p.row === z.row && p.layer === "main",
        );
        if (p && !this.protected(p.row, p.col)) {
          p.hp -= 100;
          this.effect(p.col, p.row, "hit");
        }
        z.timer = 3;
      }
      return;
    }
    if (z.underground && z.x < 0.1) {
      z.underground = false;
      z.reverse = true;
      z.freeze = 2;
    }
    if (z.id === "yeti" && z.age > 15) z.reverse = true;
    if (z.ally) {
      const target = this.zombies.find(
        (q) => !q.ally && q.row === z.row && Math.abs(q.x - z.x) < 0.5,
      );
      if (target) {
        if (z.timer <= 0) {
          this.damage(target, 100);
          z.timer = 1;
        }
        return;
      }
    }
    const target = this.plants
      .filter(
        (p) =>
          p.row === z.row &&
          Math.abs(p.col - z.x) < 0.45 &&
          plantById[p.id].kind !== "spike",
      )
      .sort(
        (a, b) =>
          ({ armor: 0, main: 1, base: 2 })[a.layer] -
          { armor: 0, main: 1, base: 2 }[b.layer],
      )[0];
    if (target && !z.flying && !z.underground && !z.ally) {
      if (
        target.ladder ||
        (z.id === "ladder" &&
          !z.jumped &&
          (target.layer === "armor" || plantById[target.id].kind === "wall"))
      ) {
        target.ladder = true;
        z.jumped = true;
        z.jump = { from: z.x, to: z.x - 1, elapsed: 0, duration: 0.7 };
        z.action = "jump";
        this.effect(z.x, z.row, "jump");
        return;
      }
      if (
        ["pole", "dolphin", "pogo"].includes(z.id) &&
        !z.jumped &&
        target.id !== "tallnut"
      ) {
        z.jump = { from: z.x, to: z.x - 1.25, elapsed: 0, duration: 0.85 };
        z.action = "jump";
        this.effect(z.x, z.row, "jump");
        if (z.id !== "pogo") z.jumped = true;

        return;
      }
      z.action = "eat";
      if (z.timer <= 0) {
        const kind = plantById[target.id].kind;
        if (kind === "hypno" && !target.sleep) {
          this.remove(target);
          z.ally = true;
          z.reverse = true;
          return;
        }
        if (kind === "garlic" && !this.water(z.row)) {
          const choices = [z.row - 1, z.row + 1].filter(
            (r) => r >= 0 && r < this.level.rows && !this.water(r),
          );
          if (choices.length)
            z.row = choices[Math.floor(this.random() * choices.length)];
        }
        target.hp -= ["garg", "zomboni", "catapult"].includes(z.id)
          ? 9999
          : 100;
        z.timer = ["garg"].includes(z.id) ? 2 : 1;
        this.effect(target.col, target.row, "bite", z.id);
      }
      return;
    }
    let speed = (d.speed / 96) * this.settings.speed;
    if (z.id === "paper" && z.armor === 0) speed *= 2.8;
    if (z.jumped && ["pole", "dolphin"].includes(z.id)) speed *= 0.5;
    if (z.slow > 0) speed *= 0.5;
    z.x += speed * dt * (z.reverse ? 1 : -1);
    z.motion += speed * dt * 96;
    if (z.id === "zomboni" && z.x < 9) {
      const col = Math.round(z.x);
      if (!this.tiles.some((t) => t.row === z.row && t.col === col))
        this.tiles.push({ row: z.row, col, type: "ice", life: 60 });
    }
    if (z.x < -0.65 && !z.ally) {
      if (this.mowers[z.row]) {
        this.mowers[z.row] = false;
        for (const q of this.zombies) if (q.row === z.row && !q.ally) q.hp = 0;
        this.effect(0, z.row, "mower");
        this.say("割草机出动！这一行已失去最后的保护");
      } else this.status = "lost";
    }
  }
  updateBoss(dt: number) {
    this.bossTimer -= dt;
    if (this.bossTimer <= 0) {
      this.bossDown = 10;
      this.bossTimer = 24;
      for (let i = 0; i < 3; i++)
        this.spawn(["basic", "cone", "bucket"][Math.floor(this.random() * 3)]);
      this.bossBall = {
        row: Math.floor(this.random() * 5),
        x: 9,
        type: this.random() < 0.5 ? "fire" : "ice",
      };
      this.say(
        this.bossBall.type === "fire"
          ? "火球来了！用寒冰菇熄灭它"
          : "冰球来了！用同一行的火爆辣椒融化它",
      );
    }
    if (this.bossBall) {
      this.bossBall.x -= dt * 0.8;
      for (const p of [...this.plants])
        if (
          p.row === this.bossBall.row &&
          Math.abs(p.col - this.bossBall.x) < 0.3
        )
          this.remove(p);
      if (this.bossBall.x < -0.5) this.bossBall = null;
    }
  }
}
