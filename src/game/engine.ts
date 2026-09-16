import { applyControl, tickControls, consumeIce, electricTarget, conductionTargets, attackTarget, projectileTarget, isLob } from "./elements";
import { WIND_DURATION, RAIN_DURATION, TOKEN_LIFETIME, tokenPose } from "./ambient";
import { jumpHeight } from "./animation";
import { plantSound, type SoundEvent, type SoundKind } from "./audio";
import { laneStrength, tiltFor, unitPrice } from "./director";
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
const DANGER_ZOMBIES = new Set([
  "garg",
  "football",
  "zomboni",
  "catapult",
  "dancer",
  "jack",
  "boss",
]);
/**
 * “盾牌”型护甲（目前只有铁栅门）：只挡正面直射的豌豆类攻击，
 * 穿透烟雾与投掷物能越过它直接打本体。
 * 路障、铁桶、橄榄球头盔属于“硬护甲”，需要先被消耗掉才会伤到本体。
 */
const SHIELD_ARMOR = new Set(["screen"]);
/** 磁力菇能吸走的金属装备。 */
const MAGNET_TARGETS = new Set(["bucket", "screen", "football"]);
/** 磁力菇能吸走的工具／器械，吸走后对应能力失效。 */
const MAGNET_TOOLS = new Set(["pogo", "digger", "ladder", "jack"]);
export type Plant = {
  uid: number;
  hurt?: number;  id: string;
  row: number;
  col: number;
  hp: number;
  max: number;
  timer: number;
  age: number;
  sleep: boolean;
  ready: boolean;
  layer: "base" | "main" | "armor";
  /** 玉米炮两格是一个整体，记录另一半的 uid。 */
  pair?: number;
  attackAge?: number;
  ladder?: boolean;
  digest?: number;
  chomp?: { target: number; elapsed: number; hit: boolean };
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
  iceSlow?: number;
  iceFreeze?: number;
  /** 上次触发冰电爆发的时刻，同一僵尸 4 秒内只爆发一次。 */
  reactAt?: number;
  weatherSlow?: number;
  otherFreeze?: number;
  freeze: number;
  timer: number;
  age: number;
  jumped: boolean;
  /** 金属装备被磁力菇吸走后置为 true（梯子、跳杆、矿镐、玩偶匣）。 */
  disarmed?: boolean;
  underground: boolean;
  flying: boolean;
  reverse: boolean;
  ally: boolean;
  thrown: boolean;
  maxArmor: number;
  motion: number;
  hurt?: number;
  golden?: boolean;
  boost?: number;
  swallowed?: boolean;
  special?: {
    kind: "smash" | "throw" | "summon";
    elapsed: number;
    duration: number;
    hit: boolean;
    target?: number;
    opponent?: boolean;
  };
  laneChange?: { from: number; elapsed: number };
  actionTime?: number;
  action: "walk" | "eat" | "jump" | "special";
  jump?: {
    from: number;
    to: number;
    elapsed: number;
    duration: number;
    kind: "vault" | "ladder" | "throw";
    fromHeight?: number;
  };
};
export type Shot = {
  uid: number;
  x: number;
  row: number;
  target: number;
  direction: number;
  originX: number;
  destinationX: number;
  damage: number;
  speed: number;
  type: string;
  hit: boolean;
  /** 直射弹丸在近距离主动瞄准潜水僵尸时才允许命中它。 */
  snorkel?: boolean;
  /** 连发队列：>0 表示尚未出膛，出膛时才确定起点并播放发射效果。 */
  delay?: number;
  /** 发射它的植物 uid；延迟出膛时用来重新定位，植物消失则取消。 */
  plant?: number;
  /** 杨桃等固定方向弹丸的行漂移速度（格/秒）。 */
  rowSpeed?: number;
  /** Each trunk transforms a projectile only once, including at slow simulation speeds. */
  torches?: number[];
};
export type Token = {
  uid: number;
  x: number;
  row: number;
  value: number;
  age: number;
  coin: boolean;
  origin?: "sky" | "plant" | "drop";
};
export type Effect = {
  uid: number;
  x: number;
  row: number;
  type: string;
  life: number;
  duration: number;
  source?: string;
  /** 发射闪光的方向，与实际弹丸出膛位置一致。 */
  direction?: number;
  zombie?: Zombie;
  height?: number;
  toX?: number;
  toRow?: number;
  screenX?: number;
  screenY?: number;
};
export type Tile = {
  row: number;
  col: number;
  type: "grave" | "crater" | "ice" | "vase";
  life: number;
  reward?: string;
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
  spareMowers: boolean[];
  iceStart = false;
  sun = 150;
  coins = 0;
  time = 0;
  spawned = 0;
  kills = 0;
  status: "playing" | "won" | "lost" = "playing";
  paused = false;
  cooldowns: Record<string, number> = {};
  selected = "";
  toolUses = 3;
  toolSource = 0;
  hammer: "ice" | "electric" = "ice";
  hammerReadyAt = 0;
  toolsUnlocked = false;
  reactions = 0;
  message = "选择种子，再点击草坪种植";
  messageTone: "info" | "alert" = "info";
  messageUntil = 6;
  hitStop = 0;
  timeScale = 1;
  winDelay = -1;
  private alerted = new Set<string>();
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
    element?: "ice" | "electric";
    hit: number[];
  }[] = [];
  private uid = 1;
  private guided = new Set<string>();
  private livingCache: Zombie[] | null = null;
  private queuedMessages: string[] = [];
  private wavePlan: string[] = [];
  private unitWaves = new Map<string, number>();
  private assaultLanes = new Map<number, number>();
  private killTimes: number[] = [];
  private streakAt = -10;
  plantsLost = 0;
  mowersLost = 0;
  assaultAlert: { at: number; row: number } | null = null;
  eventAt = -1;
  eventKind: "" | "rain" | "wind" = "";
  rainUntil = 0;
  windUntil = 0;
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
    this.toolsUnlocked = id >= 5;
    this.rng = seed || 1;
    this.mowers = Array(this.level.rows).fill(this.settings.mowers);
    this.spareMowers = Array(this.level.rows).fill(false);
    if (this.level.scene === "night") {
      const graveRows = [0, 1, 2, 3, 4];
      const graveCount = Math.min(2 + this.level.stage, 8);
      for (let i = 0; i < graveCount; i++)
        this.tiles.push({
          row: graveRows[i % graveRows.length],
          col: 5 + Math.floor(i / graveRows.length),
          type: "grave",
          life: Infinity,
        });
    }
    if (isNight(this.level.scene) && this.level.mode === "normal")
      this.say("夜晚没有天降阳光，蘑菇们更活跃；向日葵在夜里生产变慢");
    if (this.level.scene === "fog" && this.level.mode === "normal")
      this.say("夜间泳池没有天降阳光：睡莲承载水路火力，路灯花照亮右侧迷雾");
    if (this.level.scene === "roof")
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 3; c++) this.addPlant("pot", r, c);
    if (this.level.mode === "vases") {
      this.nextSpawn = Infinity;
      for (let r = 0; r < 6; r++)
        for (let c = 4; c < 8; c++)
          this.tiles.push({ row: r, col: c, type: "vase", life: Infinity });
      this.tiles.find(t => t.row === 0 && t.col === 4)!.reward = "snowpea";
      this.tiles.find(t => t.row === 1 && t.col === 4)!.reward = "arc";
      this.say("冰、电标记罐藏着组合种子；其余罐子可能有僵尸！");
    }
    if (this.level.mode === "whack") {
      this.nextSpawn = 2;
      this.say("点击僵尸，用锤子保卫庭院！");
    }
    if (this.isBelt) {
      this.sun = 0;
      if (this.level.mode !== "vases") {
        this.addBelt();
        this.addBelt();
        this.addBelt();
      }
    }
    if (this.level.mode === "normal") {
      this.eventAt = this.settings.duration * (0.3 + this.random() * 0.4);
      this.eventKind = this.random() < 0.5 ? "rain" : "wind";
    }
  }
  get isBelt() {
    return ["conveyor", "bowling", "storm", "boss", "vases"].includes(
      this.level.mode,
    );
  }
  get toolName() {
    return this.level.mode === "bowling" ? "滚球换排" : this.level.mode === "whack" ? "紧急冰冻" : "移植";
  }
  get toolHint() {
    if (this.level.mode === "whack") return "点击草坪，冻结周围九宫格 3 秒";
    if (this.level.mode === "bowling") return this.toolSource ? "点击相邻排；滚球仍会继续前进" : "点击正在滚动的球，再点击相邻排";
    return this.toolSource ? "选择绿色空格移植；底座留在原地" : "选择主植物；连南瓜搬走，每局 3 次";
  }
  inBoard(row: number, col: number) {
    return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < this.level.rows && col >= 0 && col < 9;
  }
  cancelSelection() {
    this.selected = "";
    this.toolSource = 0;
    this.cannon = 0;
  }
  selectTool() {
    if (this.paused || this.status !== "playing" || !this.toolsUnlocked) return;
    if (this.selected === "tool") { this.cancelSelection(); return; }
    this.cancelSelection();
    if (!this.toolUses) { this.say("本局工具次数已用完"); return; }
    this.selected = "tool";
    this.say(this.toolHint);
  }
  selectHammer(kind: "ice" | "electric") {
    if (this.paused || this.status !== "playing" || this.level.mode !== "whack") return;
    this.cancelSelection();
    this.hammer = kind;
  }
  movableReason(p?: Plant) {
    if (!p || p.hp <= 0 || p.layer !== "main") return "请选择一株存活的主植物";
    if (p.id === "cob") return "玉米加农炮占两格，暂时不能移植";
    if (this.shots.some(s => s.plant === p.uid && !s.hit && (s.delay ?? 0) > 0))
      return "正在连发，出膛后才能移植";
    if (p.chomp || ["bomb", "doom", "ice", "jalapeno", "blover", "grave", "coffee", "squash", "kelp"].includes(plantById[p.id].kind))
      return "正在执行一次性效果或攻击动作，不能移植";
    if (this.zombies.some(z => z.special?.kind === "smash" && z.special.target === p.uid && !z.special.hit))
      return "植物已被重击锁定，暂时不能移植";
    return "";
  }
  toolTargetReason(row: number, col: number) {
    if (!this.toolsUnlocked) return "第 1-6 关解锁移植";
    if (!this.toolUses) return "本局工具次数已用完";
    if (!this.inBoard(row, col)) return "请选择草坪内的位置";
    if (this.level.mode === "whack") return "";
    if (this.level.mode === "bowling") {
      const b = this.bowls.find(b => b.uid === this.toolSource);
      if (!b || b.x < 0 || b.x >= 9) return "请选择场内正在滚动的球";
      return Math.abs(row - b.row) === 1 ? "" : "只能移动到相邻排";
    }
    const p = this.plants.find(p => p.uid === this.toolSource);
    const reason = this.movableReason(p);
    if (reason || !p) return reason;
    if (this.tiles.some(t => t.row === row && t.col === col)) return "这里有障碍，不能移植";
    if (this.at(row, col, "main") || this.at(row, col, "armor")) return "目标格必须没有主植物和保护壳";
    const base = this.at(row, col, "base");
    if (p.id === "sea" && !this.water(row)) return "海蘑菇只能种在水上";
    if (p.id === "cattail" && !this.water(row)) return "猫尾草只能移到水路的睡莲上";
    if (["spike", "spikerock"].includes(p.id) && (this.water(row) || this.level.scene === "roof")) return "地刺只能移到陆地";
    if (this.water(row) && p.id !== "sea" && (base?.id !== "lily" || base.hp <= 0)) return "水路需要先放一片睡莲";
    if (this.level.scene === "roof" && (base?.id !== "pot" || base.hp <= 0)) return "屋顶需要先放一个花盆";
    return "";
  }
  selectBowl(uid: number) {
    if (this.paused || this.status !== "playing" || this.selected !== "tool" || !this.toolUses) return;
    const b = this.bowls.find(b => b.uid === uid && b.x >= 0 && b.x < 9);
    if (!b) { this.say("滚球已经离开草坪"); return; }
    this.toolSource = uid;
    this.say(this.toolHint);
  }
  useTool(row: number, col: number) {
    if (this.paused || this.status !== "playing" || !this.toolsUnlocked || !this.toolUses) return false;
    if (!this.inBoard(row, col)) return false;
    if (this.level.mode !== "whack" && !this.toolSource) {
      if (this.level.mode === "bowling") {
        const b = this.bowls.find(b => b.row === row && Math.abs(b.x - col) < 0.6);
        if (b) this.selectBowl(b.uid);
        else this.say("请选择场内正在滚动的球");
      } else {
        const p = this.at(row, col, "main");
        const reason = this.movableReason(p);
        if (reason || !p) this.say(reason);
        else { this.toolSource = p.uid; this.say(this.toolHint); }
      }
      return false;
    }
    const reason = this.toolTargetReason(row, col);
    if (reason) { this.say(reason); return false; }
    if (this.level.mode === "whack") {
      for (const z of this.zombies)
        if (electricTarget(z) && Math.abs(z.row - row) <= 1 && Math.abs(z.x - col) <= 1.5)
          applyControl(z, "iceFreeze", 3);
      this.effect(col, row, "ice", "emergency");
    } else if (this.level.mode === "bowling") {
      this.bowls.find(b => b.uid === this.toolSource)!.row = row;
    } else {
      const p = this.plants.find(p => p.uid === this.toolSource)!;
      const armor = this.at(p.row, p.col, "armor");
      this.effect(p.col, p.row, "shovel");
      for (const part of armor ? [p, armor] : [p]) { part.row = row; part.col = col; }
      this.effect(col, row, "plant", p.id);
    }
    this.toolUses--;
    this.cancelSelection();
    this.say(`${this.toolName}成功，剩余 ${this.toolUses} 次`);
    return true;
  }
  arcEffect(x: number, row: number, toX: number, toRow: number, reaction: boolean) {
    this.effect(x, row, reaction ? "conduction" : "electric");
    const fx = this.effects.at(-1)!;
    fx.toX = toX;
    fx.toRow = toRow;
  }
  electricHit(z: Zombie, baseDamage: number) {
    if (!electricTarget(z)) return;
    // 同一僵尸 4 秒内只能触发一次冰电爆发；冷却中命中不消耗冰控。
    const ready = this.time - (z.reactAt ?? -Infinity) >= 4;
    // Capture the reaction before base damage can kill the primary target.
    const reaction = ready && consumeIce(z);
    const targets = reaction ? conductionTargets(z, this.zombies) : [];
    if (reaction) z.reactAt = this.time;
    this.damage(z, baseDamage + (reaction ? 100 : 0));
    this.sound(reaction ? "conduction" : "electric", z.x);
    if (!reaction) return;
    this.reactions++;
    this.effect(z.x, z.row, "iceBreak");
    for (const other of targets) {
      this.arcEffect(z.x, z.row, other.x, other.row, true);
      this.damage(other, 40);
    }
  }
  random() {
    this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
  say(s: string, tone: "info" | "alert" = "info") {
    if (
      tone === "info" &&
      this.messageTone === "alert" &&
      this.time < this.messageUntil
    ) {
      if (this.queuedMessages.length < 8) this.queuedMessages.push(s);
      return;
    }
    this.message = s;
    this.messageTone = tone;
    this.messageUntil = this.time + 4;
  }
  private livingEnemies() {
    return (this.livingCache ??= this.zombies.filter(
      (z) => z.hp > 0 && !z.ally && !z.underground,
    ));
  }
  private guide(step: string, text: string): boolean {
    if (this.level.id > 3 || this.guided.has(step)) return false;
    this.guided.add(step);
    this.say(text);
    return true;
  }
  warnDanger(id: string) {
    if (!DANGER_ZOMBIES.has(id) || this.alerted.has(id)) return;
    this.alerted.add(id);
    this.say(`⚠ 强敌来袭：${zombieById[id].name}！`, "alert");
    this.sound("warning");
  }
  effect(x: number, row: number, type: string, source?: string, direction?: number) {
    const duration =
      type === "mower" ? 0.32 : type === "boom"
        ? 1.4
        : type === "ice"
          ? 1.2
          : type === "death"
            ? 0.8
            : type === "fly"
              ? 0.6
              : type === "collect"
                ? 0.7
                : 0.45;
    const sound: Partial<Record<string, SoundKind>> = {
      smash: "smash",
      chomp: "chomp",
      land: "land",
      boom: "explosion",
      ice: "freeze",
      bite: "bite",
      plant: "plant",
      sun: "sun",
      collect: source === "coin" ? "coin" : "sun",
      magnet: "magnet",
      wind: "wind",
      splash: "splash",
      death: "death",
      mower: "mower",
      jump: "jump",
      shovel: "shovel",
    };
    if (type === "collect" && source === "coin") this.sound("coin", x, source);
    else if (sound[type]) this.sound(sound[type]!, x, source);
    if (type === "boom") this.hitStop = Math.max(this.hitStop, 0.06);
    else if (type === "smash") this.hitStop = Math.max(this.hitStop, 0.05);
    this.effects.push({
      uid: this.uid++,
      x,
      row,
      type,
      life: duration,
      duration,
      source,
      direction,
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
      if (this.cooldowns[id] > 0) this.say("种子还在冷却");
      else if (
        !this.guide(
          "sun",
          this.level.id <= 1
            ? "阳光不足，先收集落下的阳光"
            : "阳光不足，先等向日葵生产",
        )
      )
        this.say("阳光不足，先收集阳光");
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
        element: d.id === "snowpea" ? "ice" : d.id === "arc" ? "electric" : undefined,
        hit: [],
      });
      return true;
    }
    if (d.id === "coffee") {
      this.at(row, col, "main")!.sleep = false;
      this.effect(col, row, "sun");
      return true;
    }
    let keepAwake = false;
    if (d.upgrade) {
      const old = this.plants.find(
        (p) => p.row === row && p.col === col && p.id === d.upgrade,
      );
      if (old) {
        // 咖啡豆唤醒过的蘑菇（如大喷菇升忧郁菇）升级后保持清醒。
        keepAwake = !old.sleep;
        // 只移除被替换的那一株，不连带同格的南瓜头等其它植物；
        // 香蒲保留睡莲底座，升级后同格南瓜仍在、也能继续补种。
        if (d.id !== "cattail")
          this.plants = this.plants.filter((q) => q.uid !== old.uid);
      }
      if (d.id === "cob") {
        const second = this.at(row, col + 1, "main");
        if (second) this.remove(second);
      }
    }
    const p = this.addPlant(d.id, row, col);
    if (keepAwake) p.sleep = false;
    if (d.id === "cob") {
      p.timer = 8;
      const blocker = this.addPlant("kernel", row, col + 1);
      blocker.id = "cob";
      blocker.ready = false;
      blocker.timer = Infinity;
      p.pair = blocker.uid;
      blocker.pair = p.uid;
    }
    this.effect(col, row, "plant", d.id);
    this.guide("planted", "点击落下的阳光，攒够阳光继续种");
    return true;
  }
  remove(p: Plant, destroyed = false) {
    const before = this.plants.length;
    // 玉米炮的任何一半被铲除或摧毁，另一半一起移除，不留无法发射的残格。
    const pair = p.pair
      ? this.plants.find((q) => q.uid === p.pair)
      : undefined;
    this.plants = this.plants.filter(
      (q) => q.uid !== p.uid && q.uid !== pair?.uid,
    );
    if (p.layer === "base")
      this.plants = this.plants.filter(
        (q) => q.row !== p.row || q.col !== p.col,
      );
    if (destroyed) this.plantsLost += before - this.plants.length;
  }
  shovel(row: number, col: number) {
    if (this.paused || this.status !== "playing") return;
    const p =
      this.at(row, col, "armor") ||
      this.at(row, col, "main") ||
      this.at(row, col, "base");
    if (p) {
      // remove() 会连带移除玉米炮配对的另一半。
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
    const pose = tokenPose(t, this.level.rows);
    for (const type of ["collect", "fly"]) {
      this.effect(t.x, t.row, type, t.coin ? "coin" : "sun");
      const fx = this.effects.at(-1)!;
      fx.screenX = pose.x;
      fx.screenY = pose.y;
    }
    this.tokens = this.tokens.filter((t) => t.uid !== uid);
  }
  token(x: number, row: number, value = 25, coin = false, origin: Token["origin"] = coin ? "drop" : "plant") {
    this.tokens.push({ uid: this.uid++, x, row, value, coin, age: 0, origin });
  }
  addBelt() {
    if (this.conveyor.length >= 9 || this.level.mode === "vases") return;
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
    pool = [...new Set([...pool, "snowpea", "arc"])];
    if (this.level.mode === "bowling") pool = ["wallnut", "wallnut", "cherry", "snowpea", "arc"];
    if (this.level.mode === "boss")
      pool = ["cabbage", "kernel", "melon", "ice", "jalapeno", "pot", "snowpea", "arc"];
    if (this.level.scene === "roof" && this.random() < 0.3) pool = ["pot"];
    if (this.water(2) && this.random() < 0.25) pool = ["lily"];
    this.conveyor.push(pool[Math.floor(this.random() * pool.length)] || "pea");
  }
  composeWave(wave: number): string[] {
    const slots = this.schedule.reduce((n, e) => n + (e.wave === wave ? 1 : 0), 0);
    const progress = (wave - 1) / Math.max(1, this.totalWaves - 1);
    const unlocked = this.level.enemies
      .slice(
        0,
        Math.max(
          1,
          Math.ceil(
            this.level.enemies.length * Math.min(1, 0.45 + progress * 1.1),
          ),
        ),
      )
      .filter((id) => unitPrice[id]);
    const novice = this.level.id <= 3 || this.settings.difficulty === "casual";
    const average =
      unlocked.reduce((s, id) => s + unitPrice[id], 0) / unlocked.length;
    let budget = Math.ceil(slots * average);
    // 领先的玩家（阳光充足、没有丢车）会面对更厚的波次；已经吃紧时不加档。
    const struggling = this.mowersLost > 0 || this.plantsLost >= 4;
    const rich = !novice && !struggling && this.sun > 400 ? 1.35 : 0;
    const dominant =
      !novice &&
      !struggling &&
      this.sun > 600 &&
      this.mowersLost === 0 &&
      this.livingEnemies().length <= 3
        ? 1.35
        : 0;
    let factor = Math.max(1, rich, dominant);
    if (!novice) {
      let rubber = 1;
      if (this.mowersLost > 0) rubber -= 0.2;
      if (this.plantsLost >= 4) rubber -= 0.2;
      factor *= Math.max(0.6, rubber);
    }
    budget = Math.ceil(budget * factor);
    const next = wave + 1;
    if (
      !novice &&
      next <= this.totalWaves &&
      (next % 4 === 0 || next === this.totalWaves)
    ) {
      const nextAt = this.schedule.find((e) => e.wave === next)?.at;
      if (nextAt !== undefined) {
        const candidates = Array.from({ length: this.level.rows }, (_, r) => r)
          .filter(r => !this.water(r));
        let weakest = candidates[0];
        for (const r of candidates.slice(1))
          if (
            laneStrength(this.plants, this.zombies, r) <
            laneStrength(this.plants, this.zombies, weakest)
          )
            weakest = r;
        this.assaultAlert = { at: Math.max(this.time, nextAt - 4), row: weakest };
        this.assaultLanes.set(next, weakest);
      }
    }
    const weights = new Map(unlocked.map((id) => [id, 1]));
    const boost = (ids: string[], factor: number) => {
      const f = novice ? 1 + (factor - 1) / 2 : factor;
      for (const id of ids)
        if (weights.has(id)) weights.set(id, weights.get(id)! * f);
    };
    let wallShooterRows = 0,
      waterOpen = false;
    const rowCost = Array(this.level.rows).fill(0);
    for (let r = 0; r < this.level.rows; r++) {
      const ps = this.plants.filter((p) => p.row === r && p.hp > 0);
      if (
        ps.some((p) => ["wall", "armor"].includes(plantById[p.id].kind)) &&
        ps.some((p) => !p.sleep && plantById[p.id].damage)
      )
        wallShooterRows++;
      if (this.water(r) && !ps.some((p) => !p.sleep && plantById[p.id].damage))
        waterOpen = true;
      for (const p of ps) rowCost[r] += plantById[p.id].cost;
    }
    if (wallShooterRows >= 2)
      boost(["pole", "dolphin", "pogo", "ladder", "digger"], 3);
    if (this.plants.some((p) => p.id === "tallnut"))
      boost(["balloon", "catapult"], 3);
    if (this.plants.length > this.level.rows * 4) boost(["jack", "garg"], 2.5);
    const meanCost = rowCost.reduce((a, b) => a + b, 0) / this.level.rows;
    if (Math.max(...rowCost) > Math.max(300, meanCost * 2)) boost(["bungee"], 3);
    if (waterOpen) boost(["snorkel", "dolphin"], 3);
    const available = unlocked.filter((id) => {
      const last = this.unitWaves.get(id);
      if (last === undefined) return true;
      const gap = ["garg"].includes(id)
        ? 2
        : ["football", "zomboni", "catapult"].includes(id)
          ? 1
          : 0;
      return wave - last > gap;
    });
    const usable = available.length ? available : unlocked;
    const plan: string[] = [];
    while (plan.length < slots && budget > 0) {
      const affordable = usable.filter((id) => unitPrice[id] <= budget);
      if (!affordable.length) break;
      let roll =
        this.random() * affordable.reduce((s, id) => s + weights.get(id)!, 0);
      let pick = affordable[0];
      for (const id of affordable) {
        roll -= weights.get(id)!;
        if (roll <= 0) {
          pick = id;
          break;
        }
      }
      plan.push(pick);
      budget -= unitPrice[pick];
    }
    if (!plan.length) plan.push(usable[0]);
    if (wave % 4 === 0 || wave === this.totalWaves) plan[0] = "flag";
    for (const id of new Set(plan)) this.unitWaves.set(id, wave);
    return plan;
  }
  private pickRow(id: string): number {
    const rows = Array.from({ length: this.level.rows }, (_, r) => r);
    const land = rows.filter((r) => !this.water(r));
    const water = rows.filter(r => this.water(r));
    const aquatic = ["ducky", "snorkel", "dolphin"].includes(id);
    const candidates = aquatic && water.length ? water : ["balloon", "bungee"].includes(id)
      ? rows
      : land.length
        ? land
        : rows;
    if (!["normal", "conveyor", "storm"].includes(this.level.mode))
      return candidates[Math.floor(this.random() * candidates.length)];
    const assault = this.assaultLanes.get(this.wave);
    if (assault !== undefined && candidates.includes(assault) && this.random() < 0.6)
      return assault;
    const [weakP, strongP] = tiltFor(this.level.id, this.settings.difficulty);
    const roll = this.random();
    if (roll >= weakP && roll < 1 - strongP)
      return candidates[Math.floor(this.random() * candidates.length)];
    const order = candidates
      .map((r) => ({
        r,
        s: laneStrength(this.plants, this.zombies, r),
        j: this.random(),
      }))
      .sort((a, b) => a.s - b.s || a.j - b.j);
    const bandSize = Math.min(2, Math.max(1, Math.floor(order.length / 2)));
    const band = roll < weakP ? order.slice(0, bandSize) : order.slice(-bandSize);
    return band[Math.floor(this.random() * band.length)].r;
  }
  spawn(id: string, row?: number, x = 9.6) {
    const d = zombieById[id];
    if (!d) return;
    const aquatic = ["ducky", "snorkel", "dolphin"].includes(id);
    let r = aquatic
      ? row !== undefined && this.water(row) ? row : this.pickRow(id)
      : (row ?? this.pickRow(id));
    if (
      !aquatic &&
      row === undefined &&
      this.water(r) &&
      !["balloon", "bungee"].includes(id)
    )
      r = [0, 1, 4, 5][Math.floor(this.random() * 4)];
    if (id === "bungee") x = 1 + Math.floor(this.random() * 7);
    this.sound("groan", x, id);
    this.guide("zombie", "僵尸来了！在它所在的一行种射手");
    this.zombies.push({
      uid: this.uid++,
      id,
      row: r,
      x,
      hp: d.hp * this.settings.health,
      max: d.hp * this.settings.health,
      armor: d.armor * this.settings.health,
      maxArmor: d.armor * this.settings.health,
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
    if (this.windUntil > this.time)
      applyControl(this.zombies.at(-1)!, "weatherSlow", this.windUntil - this.time);
    this.livingCache = null;
  }
  /**
   * pierce：完全无视护甲（爆炸、火焰、碾压、尖刺、吞噬等）。
   * throughShield：只越过“盾牌”护甲（铁栅门），头盔类护甲照常吸收。
   */
  damage(z: Zombie, amount: number, pierce = false, throughShield = false) {
    if (z.hp <= 0) return;
    z.hurt = 0.16;
    const oldArmor = z.armor;
    const bypass = pierce || (throughShield && SHIELD_ARMOR.has(z.id));
    this.sound(z.armor > 0 && !bypass ? "metal" : "hit", z.x, z.id);
    let rest = amount;
    if (z.armor > 0 && !bypass) {
      const used = Math.min(z.armor, rest);
      z.armor -= used;
      rest -= used;
    }
    z.hp -= rest;
    if (z.hp <= 0) this.livingCache = null;
    if (oldArmor > 0 && z.armor === 0) {
      this.effect(z.x, z.row, "break", z.id);
      this.sound("break", z.x, z.id);
    }
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
  click(row: number, col: number, keep = false) {
    if (this.paused || this.status !== "playing" || !this.inBoard(row, col)) return;
    if (this.selected === "tool") { this.useTool(row, col); return; }
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
      if (vase.reward) this.conveyor.push(vase.reward);
      else if (this.random() < 0.4)
        this.spawn(this.random() < 0.2 ? "bucket" : "basic", row, col);
      else
        this.conveyor.push(
          this.water(row)
            ? "kelp"
            : ["pea", "snowpea", "squash"][Math.floor(this.random() * 3)],
        );
      return;
    }
    let cannon = this.at(row, col, "main");
    if (cannon?.id === "cob" && !cannon.ready && cannon.pair) {
      // 点玉米炮的右半格同样转到主炮的就绪检查与瞄准。
      const main = this.plants.find((q) => q.uid === cannon!.pair);
      if (main?.id === "cob") cannon = main;
    }
    if (cannon?.id === "cob" && cannon.ready) {
      this.cannon = cannon.uid;
      this.say("点击目标区域发射玉米炮");
      return;
    }
    if (this.selected && this.plant(this.selected, row, col) && !keep)
      this.selected = "";
  }
  hitZombie(uid: number) {
    if (this.level.mode !== "whack" || this.paused || this.status !== "playing")
      return;
    const z = this.zombies.find((z) => z.uid === uid);
    if (!z || !electricTarget(z) || this.time + 1e-9 < this.hammerReadyAt) return;
    this.hammerReadyAt = this.time + 0.4;
    if (this.hammer === "ice") {
      this.damage(z, 20);
      applyControl(z, "iceFreeze", 3);
      this.effect(z.x, z.row, "ice", "hammer");
    } else this.electricHit(z, 120);
  }
  shoot(
    p: Plant,
    z: Zombie | undefined,
    damage: number,
    type?: string,
    options: { delay?: number; direction?: number; rowSpeed?: number } = {},
  ) {
    const original = this.plants.find((q) => q.uid === p.uid);
    // 黄油在发射前确定：飞行途中就能看到是玉米粒还是黄油，
    // 黄油伤害更高（40），命中定身由碰撞分支处理。
    // 只有规则层按默认弹种发射时才掷骰；显式指定的类型原样保留。
    if (type === undefined && p.id === "kernel" && this.random() < 0.25) {
      type = "butter";
      damage *= 2;
    }
    type = type ?? p.id;
    const speed = ["lob", "homing"].includes(plantById[p.id].kind) ? 4 : 6;
    if (options.delay && options.delay > 0) {
      // 连发排队：不在排队时播放声音或闪光；出膛时才确定方向与起点。
      this.shots.push({
        uid: this.uid++,
        x: p.col,
        row: p.row,
        target: z?.uid ?? 0,
        direction: options.direction ?? 0,
        originX: p.col,
        destinationX: z?.x ?? p.col,
        damage,
        speed,
        type,
        hit: false,
        delay: options.delay,
        plant: original?.uid,
      });
      return;
    }
    if (original) original.attackAge = 0;
    const direction = options.direction ?? (z ? (z.x >= p.col ? 1 : -1) : 1);
    const originX = p.col + direction * 0.35;
    this.shots.push({
      uid: this.uid++,
      x: originX,
      row: p.row,
      target: z?.uid ?? 0,
      direction,
      originX,
      destinationX: z?.x ?? originX,
      damage,
      speed,
      type,
      hit: false,
      rowSpeed: options.rowSpeed,
      snorkel: z?.id === "snorkel" || undefined,
    });
    this.effect(p.col, p.row, "shoot", type, direction);
    this.sound(plantSound(type === "butter" ? type : p.id), p.col, p.id);
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
    this.livingCache = null;
    if (this.time >= this.messageUntil && this.queuedMessages.length) {
      this.message = this.queuedMessages.shift()!;
      this.messageTone = "info";
      this.messageUntil = this.time + 4;
    }
    if (this.assaultAlert && this.time >= this.assaultAlert.at) {
      this.say(`僵尸主力瞄准了第 ${this.assaultAlert.row + 1} 行！`, "alert");
      this.assaultAlert = null;
    }
    if (this.eventAt > 0 && this.time >= this.eventAt) {
      this.eventAt = -1;
      if (this.eventKind === "rain") {
        this.rainUntil = this.time + RAIN_DURATION;
        for (const p of this.plants)
          if (plantById[p.id].kind === "sun")
            this.token(
              p.col,
              p.row,
              p.id === "twin" ? 50 : p.id === "sunshroom" && p.age < 120 ? 15 : 25,
            );
        this.say("阳光雨！向日葵立刻产出，阳光掉落加速");
        this.sound("sun");
      } else {
        this.windUntil = this.time + WIND_DURATION;
        for (const z of this.zombies) applyControl(z, "weatherSlow", WIND_DURATION);
        this.say("寒风过境！冰霜凝结，僵尸们被冻得行动迟缓");
        this.sound("frost");
      }
    }
    for (const p of this.plants)
      if (p.attackAge !== undefined) p.attackAge += dt;
    this.fogClear = Math.max(0, this.fogClear - dt);
    this.bossDown = Math.max(0, this.bossDown - dt);
    for (const id in this.cooldowns)
      this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    this.effects.forEach((e) => (e.life -= dt));
    this.effects = this.effects.filter((e) => e.life > 0);
    this.tokens.forEach((t) => (t.age += dt));
    this.tokens = this.tokens.filter((t) => t.age < TOKEN_LIFETIME);
    this.tiles.forEach((t) => (t.life -= dt));
    this.tiles = this.tiles.filter((t) => t.life > 0);
    if (!this.isBelt && !isNight(this.level.scene)) {
      this.natural -= dt;
      if (this.natural <= 0) {
        this.token(
          0.4 + this.random() * 7.8,
          this.random() * (this.level.rows - 1),
          25, false, "sky",
        );
        this.natural = this.time < this.rainUntil ? 3 : 6;
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
        if (event.wave === this.totalWaves) this.sound("horn");
        if (event.wave % 4 === 0 || event.wave === this.totalWaves)
          this.say("一大波僵尸正在接近！");
        if (this.level.mode !== "whack") this.wavePlan = this.composeWave(event.wave);
      }
      const id =
        this.level.mode === "whack"
          ? event.id
          : this.wavePlan.length
            ? this.wavePlan.shift()!
            : null;
      if (!id) continue;
      this.spawn(
        id,
        undefined,
        this.level.mode === "whack" ? 4 + this.random() * 4 : 9.6,
      );
      if (
        this.level.mode === "normal" &&
        !DANGER_ZOMBIES.has(id) &&
        this.random() < 0.02
      ) {
        this.zombies.at(-1)!.golden = true;
        this.say("黄金僵尸出现了！击败它获得金币");
      }
      // Elite variants: from the mid game some zombies randomly spawn enraged —
      // +60% health/armor and +30% speed, with odds growing each wave.
      const rageChance =
        event.wave >= 7 ? Math.min(0.35, 0.05 + (event.wave - 7) * 0.03) : 0;
      if (rageChance > 0 && this.random() < rageChance) {
        const zed = this.zombies.at(-1)!;
        zed.hp *= 1.6;
        zed.max *= 1.6;
        zed.armor *= 1.6;
        zed.maxArmor *= 1.6;
        zed.boost = 1.3;
        if (!this.alerted.has("rage")) {
          this.alerted.add("rage");
          this.say("狂暴僵尸混入敌群！红色的它们更快、更强", "alert");
          this.sound("danger");
        }
      }
      this.warnDanger(id);
      if (this.spawned === this.schedule.length && this.level.scene === "night") {
        const graves = this.tiles.filter((tile) => tile.type === "grave");
        if (graves.length) {
          this.say("墓碑里爬出了僵尸！", "alert");
          this.sound("danger");
          const stage = this.level.stage;
          graves.forEach((tile, i) => {
            const id =
              stage >= 8
                ? i % 3 === 0
                  ? "bucket"
                  : i % 2
                    ? "cone"
                    : "basic"
                : stage >= 4
                  ? i % 2
                    ? "cone"
                    : "basic"
                  : "basic";
            this.effect(tile.col, tile.row, "dust");
            this.spawn(id, tile.row, tile.col);
          });
        }
      }
    }
    if (this.iceStart && this.spawned > 0) {
      this.iceStart = false;
      for (const z of this.zombies) applyControl(z, "iceFreeze", 4);
      this.sound("freeze");
    }
    if (this.level.mode === "boss") this.updateBoss(dt);
    for (const p of [...this.plants]) {
      if (p.hp <= 0) continue;
      p.age += dt;
      if (p.hurt) p.hurt = Math.max(0, p.hurt - dt);
      if (p.sleep) continue;
      p.timer -= dt;
      if (p.digest) p.digest = Math.max(0, p.digest - dt);
      const d = plantById[p.id];
      const targets = this.livingEnemies();
      const ahead = targets
        .filter(
          (z) =>
            z.row === p.row &&
            z.x > p.col - 0.2 &&
            attackTarget(z, ["cactus", "cattail"].includes(p.id),
              z.x < p.col + 0.65 || d.kind === "lob"),
        )
        .sort((a, b) => a.x - b.x);
      if (d.kind === "sun" && p.timer <= 0) {
        this.token(
          p.col,
          p.row,
          p.id === "sunshroom" && p.age < 120 ? 15 : p.id === "twin" ? 50 : 25,
        );
        // 夜晚与迷雾关没有天降阳光，向日葵类生产间隔放慢到 36 秒。
        p.timer =
          isNight(this.level.scene) &&
          (p.id === "sunflower" || p.id === "twin")
            ? 36
            : 24;
      }
      if (d.kind === "coin") {
        if (p.id === "goldmagnet") {
          // 金币 16 秒消失，24 秒的固定间隔会漏币：有币快消失时立刻收取。
          if (p.timer <= 0 || this.tokens.some((t) => t.coin && t.age > 13)) {
            for (const t of [...this.tokens]) if (t.coin) this.collect(t.uid);
            p.timer = 24;
          }
        } else if (p.timer <= 0) {
          this.token(p.col, p.row, 10, true);
          p.timer = 24;
        }
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
            applyControl(z, "iceFreeze", 4);
            applyControl(z, "iceSlow", 15);
          }
          this.effect(p.col, p.row, "ice", p.id);
          if (this.bossBall?.type === "fire") this.bossBall = null;
        }
        if (d.kind === "jalapeno") {
          for (const z of targets)
            if (z.hp > 0 && z.row === p.row) {
              consumeIce(z);
              this.damage(z, 1800, true);
            }
          this.tiles = this.tiles.filter(
            (t) => !(t.type === "ice" && t.row === p.row),
          );
          for (let c = 0; c < 9; c++) this.effect(c, p.row, "boom", "jalapeno");
          if (this.bossBall?.type === "ice" && this.bossBall.row === p.row)
            this.bossBall = null;
        }
        if (d.kind === "blover") {
          for (const z of targets)
            if (z.flying) {
              z.hp = 0;
              this.livingCache = null;
            }
          this.fogClear = 20;
          this.effect(p.col, p.row, "wind", p.id);
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
      if (d.kind === "chomp") {
        if (!p.chomp && p.timer <= 0 && ahead.some((z) => z.x < p.col + 1))
          p.chomp = { target: ahead[0].uid, elapsed: 0, hit: false };
        if (p.chomp) {
          const bite = p.chomp;
          bite.elapsed += dt;
          if (!bite.hit && bite.elapsed >= 0.3) {
            bite.hit = true;
            const victim = this.zombies.find(
              (z) =>
                z.uid === bite.target &&
                z.hp > 0 &&
                !z.ally &&
                !z.flying &&
                !z.underground &&
                z.row === p.row &&
                z.x > p.col - 0.3 &&
                z.x < p.col + 1.1,
            );
            if (victim) {
              this.damage(victim, 1800, true);
              if (victim.hp <= 0) victim.swallowed = true;
              p.timer = 35;
              p.digest = 35;
              this.effect(p.col + 0.4, p.row, "chomp", p.id);
            } else p.timer = 0.6;
          }
          if (bite.elapsed >= 0.6) p.chomp = undefined;
        }
      }
      if (
        ["squash", "kelp"].includes(d.kind) &&
        p.timer <= 0 &&
        ahead.some((z) => z.x < p.col + 1)
      ) {
        this.damage(ahead[0], 1800, true);
        this.effect(p.col, p.row, d.kind === "kelp" ? "splash" : "smash", p.id);
        this.remove(p);
      }
      if (d.kind === "spike" && p.timer <= 0) {
        for (const z of targets)
          if (z.row === p.row && Math.abs(z.x - p.col) < 0.6 && !z.flying) {
            this.damage(z, d.damage!, true);
            if (["zomboni", "catapult"].includes(z.id)) {
              z.hp = 0;
              this.livingCache = null;
              p.hp -= 300;
              p.hurt = 0.2;
              if (p.id === "spike") p.hp = 0;
            }
          }
        p.timer = 1;
      }
      if (d.kind === "magnet" && p.timer <= 0) {
        // 共享目标列表排除了地下单位，但矿工的矿镐也是金属，磁力菇要能吸到它。
        const z = this.zombies.find(
          (z) =>
            z.hp > 0 &&
            !z.ally &&
            Math.abs(z.x - p.col) < 3 &&
            Math.abs(z.row - p.row) < 2 &&
            ((MAGNET_TARGETS.has(z.id) && z.armor > 0) ||
              (MAGNET_TOOLS.has(z.id) && !z.disarmed)),
        );
        if (z) {
          // 吸走头盔／铁栅门／梯子：护甲一起消失。
          z.armor = 0;
          z.disarmed = true;
          if (MAGNET_TOOLS.has(z.id)) z.jumped = true;
          z.underground = false;
          p.timer = 12;
          this.effect(z.x, z.row, "magnet", p.id);
        }
      }
      if (d.kind === "cannon" && p.timer <= 0) p.ready = true;
      if (d.kind === "electric" && p.timer <= 0) {
        const target = ahead.find(z => electricTarget(z) && z.x >= p.col);
        if (target) {
          p.attackAge = 0;
          p.timer = d.interval!;
          this.arcEffect(p.col, p.row, target.x, target.row, false);
          this.electricHit(target, d.damage!);
        }
      }
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
              attackTarget(z) &&
              Math.abs(z.row - p.row) < (d.kind === "gloom" ? 2 : 1) &&
              (d.kind === "gloom"
                ? Math.abs(z.x - p.col) < 1.5
                : z.x >= p.col && z.x < p.col + 4),
          );
          for (const z of group) {
            // 烟雾能穿过铁栅门，但打不穿路障、铁桶和橄榄球头盔。
            this.damage(z, d.damage!, false, true);
            fired = true;
          }
        } else if (d.kind === "star") {
          // 杨桃固定向五个方向各发一颗星，数量不随敌人多少变化。
          const inRange = targets.some(
            (z) =>
              Math.abs(z.x - p.col) < 3 &&
              Math.abs(z.row - p.row) <= 2 &&
              !z.flying,
          );
          if (inRange) {
            for (const [dx, dr] of [
              [-1, 0],
              [-1, -1],
              [-1, 1],
              [1, -1],
              [1, 1],
            ] as const)
              this.shoot(p, undefined, d.damage!, "star", {
                direction: dx,
                rowSpeed: dr * 6,
              });
            fired = true;
          }
        } else if (d.kind === "homing") {
          if (targets[0]) {
            // 香蒲每轮两枚追踪尖刺，第二枚稍晚出膛并重新瞄准。
            this.shoot(p, targets[0], d.damage!);
            for (let i = 1; i < (d.burst ?? 1); i++)
              this.shoot(p, targets[0], d.damage!, undefined, {
                delay: i * 0.15,
              });
            fired = true;
          }
        } else {
          if (p.id === "split") {
            // 裂荚射手同时照顾前后：前方最近的目标和后方最近的目标各发一颗。
            const behind = targets
              .filter((z) => z.row === p.row && !z.flying && z.x < p.col - 0.2)
              .sort((a, b) => b.x - a.x)[0];
            if (
              ahead[0] &&
              !(
                this.level.scene === "roof" &&
                p.col < 4 &&
                ahead[0].x > 4
              )
            ) {
              this.shoot(p, ahead[0], d.damage!);
              fired = true;
            }
            if (behind) {
              this.shoot(p, behind, d.damage!);
              this.shoot(p, behind, d.damage!, undefined, {
                delay: 0.15,
                direction: -1,
              });
              fired = true;
            }
          }
          const lanes =
            p.id === "three" ? [p.row - 1, p.row, p.row + 1] : [p.row];
          for (const lane of p.id === "split" ? [] : lanes) {
            let z =
              lane === p.row
                ? ahead[0]
                : targets.find(
                    (z) =>
                      z.row === lane &&
                      z.x > p.col &&
                      !z.flying &&
                      (z.id !== "snorkel" ||
                        z.x < p.col + 0.65 ||
                        z.action === "eat" ||
                        d.kind === "lob"),
                  );
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
              // 双发/机枪真实连发：每颗独立结算，前一目标死亡不吞掉后续弹丸。
              if (lane === p.row)
                for (let i = 1; i < (d.burst ?? 1); i++)
                  this.shoot({ ...p, row: lane }, z, d.damage!, undefined, {
                    delay: i * 0.15,
                  });
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
      if (s.delay && s.delay > 0) {
        // 连发排队：出膛时刻重新瞄准；植物或合法目标都不在就取消这颗弹丸。
        s.delay -= dt;
        if (s.delay > 0) continue;
        const homingShot = s.type === "cattail";
        const source = this.plants.find(
          (q) => q.uid === s.plant && q.hp > 0 && !q.sleep,
        );
        let z = this.zombies.find(
          (q) => q.uid === s.target && q.hp > 0 && !q.ally && !q.underground,
        );
        if (source && (!z || (!homingShot && z.row !== source.row))) {
          z = this.zombies
            .filter(
              (q) =>
                q.hp > 0 &&
                !q.ally &&
                !q.underground &&
                (homingShot
                  ? !q.flying || s.type === "cattail"
                  : q.row === source.row &&
                    !q.flying &&
                    (s.direction >= 0
                      ? q.x > source.col - 0.2
                      : q.x < source.col + 0.2) &&
                    (q.id !== "snorkel" ||
                      q.x < source.col + 0.65 ||
                      q.action === "eat")),
            )
            .sort((a, b) =>
              homingShot
                ? Math.abs(a.x - source.col) +
                  Math.abs(a.row - source.row) -
                  (Math.abs(b.x - source.col) + Math.abs(b.row - source.row))
                : s.direction >= 0
                  ? a.x - b.x
                  : b.x - a.x,
            )[0];
        }
        if (!source || !z) {
          s.hit = true;
          continue;
        }
        s.target = z.uid;
        if (!s.direction) s.direction = z.x >= source.col ? 1 : -1;
        s.row = source.row;
        s.originX = source.col + s.direction * 0.35;
        s.x = s.originX;
        s.destinationX = z.x;
        s.snorkel = z.id === "snorkel" || undefined;
        source.attackAge = 0;
        this.effect(source.col, source.row, "shoot", s.type, s.direction);
        this.sound(
          plantSound(s.type === "butter" ? s.type : source.id),
          source.col,
          source.id,
        );
        continue;
      }
      const homing = s.type === "cattail";
      const lob = isLob(s.type);
      let target = this.zombies.find(
        (z) => z.uid === s.target && projectileTarget(z, s.type, !!s.snorkel),
      );
      if (homing && !target)
        target = this.zombies.find(
          (z) => projectileTarget(z, s.type),
        );
      if (homing && target) {
        s.target = target.uid;
        s.direction = target.x >= s.x ? 1 : -1;
      }
      const previous = s.x;
      s.x += s.direction * s.speed * dt;
      if (s.rowSpeed) s.row += s.rowSpeed * dt;
      if ((homing || lob || (s.type === "star" && !s.rowSpeed)) && target)
        s.row += (target.row - s.row) * Math.min(1, dt * 9);
      // 小喷菇/海蘑菇的孢子飞三格后消散，近处目标先死也不会继续飞。
      if (["puff", "sea"].includes(s.type) && Math.abs(s.x - s.originX) > 3) {
        s.hit = true;
        continue;
      }
      if (s.x < -1 || s.x > 11 || s.row < -1 || s.row > this.level.rows) {
        s.hit = true;
        continue;
      }
      const z = this.zombies
        .filter(
          (z) =>
            projectileTarget(z, s.type, !!s.snorkel) &&
            Math.abs(z.row - s.row) < 0.35 &&
            z.x >= Math.min(previous, s.x) - 0.18 &&
            z.x <= Math.max(previous, s.x) + 0.18,
        )
        .sort((a, b) => Math.abs(a.x - previous) - Math.abs(b.x - previous))[0];
      // Resolve crossed trunks in travel order, stopping at the first collision.
      const endX = z ? z.x : s.x;
      const torches = this.plants.filter(p => p.id === "torch" && p.hp > 0 &&
        p.row === s.row && !s.torches?.includes(p.uid) &&
        p.col >= Math.min(previous, endX) - 0.15 &&
        p.col <= Math.max(previous, endX) + 0.15)
        .sort((a, b) => s.direction * (a.col - b.col));
      for (const torch of torches) {
        (s.torches ??= []).push(torch.uid);
        if (s.type === "snowpea") s.type = "pea";
        else if (["pea", "repeater", "three", "gatling", "split"].includes(s.type)) {
          s.damage *= 2;
          s.type = "fire";
        }
      }
      if (z) {
        s.hit = true;
        if (s.type === "fire") consumeIce(z);
        this.damage(z, s.damage, false, isLob(s.type));
        if (["snowpea", "winter"].includes(s.type)) applyControl(z, "iceSlow", 10);
        if (s.type === "butter") applyControl(z, "otherFreeze", 3);
        if (s.type === "cactus" || s.type === "cattail") z.flying = false;
        if (["melon", "winter", "fire"].includes(s.type))
          for (const other of this.zombies)
            if (
              other.uid !== z.uid &&
              projectileTarget(other, s.type) &&
              Math.abs(other.x - z.x) < 1 &&
              Math.abs(other.row - z.row) <= 1
            ) {
              if (s.type === "fire") consumeIce(other);
              this.damage(other, s.damage / 3, false, isLob(s.type));
              if (s.type === "winter") applyControl(other, "iceSlow", 10);
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
          (!b.element || electricTarget(z)) &&
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
          if (b.element === "ice") {
            this.damage(z, 20);
            applyControl(z, "iceSlow", 5);
            this.effect(z.x, z.row, "ice", "bowl");
          } else if (b.element === "electric") this.electricHit(z, 100);
          else this.damage(z, 550);
          const rows = [b.row - 1, b.row + 1].filter(
            (r) => r >= 0 && r < this.level.rows,
          );
          b.row = rows[Math.floor(this.random() * rows.length)];
        }
      }
    }
    this.bowls = this.bowls.filter((b) => b.x < 10.5);

    for (const z of [...this.zombies]) {
      // The same deadline governs the weather visual and every current/new unit.
      if (this.windUntil > this.time)
        applyControl(z, "weatherSlow", this.windUntil - this.time + dt);
      this.updateZombie(z, dt);
    }
    const dead = this.zombies.filter((z) => z.hp <= 0);
    this.kills += dead.filter((z) => !z.ally).length;
    for (const z of dead) {
      if (!z.swallowed) {
        this.effect(z.x, z.row, "death", z.id);
        const fx = this.effects.at(-1)!;
        fx.zombie = { ...z };
        fx.height = jumpHeight(z);
      }
      if (this.random() < 0.04) this.token(z.x, z.row, 5, true);
      if (z.golden)
        this.token(z.x, z.row, 100 + Math.floor(this.random() * 51), true);
    }
    const killsNow = dead.filter((z) => !z.ally);
    if (killsNow.length) {
      this.killTimes = this.killTimes.filter((t) => this.time - t <= 3);
      for (let i = 0; i < killsNow.length; i++) this.killTimes.push(this.time);
      if (this.killTimes.length >= 4 && this.time - this.streakAt > 10) {
        this.streakAt = this.time;
        this.killTimes = [];
        const last = killsNow.at(-1)!;
        this.token(last.x, last.row, 25);
        this.say("连杀奖励！+25 阳光");
        this.sound("sun");
      }
    }
    this.zombies = this.zombies.filter((z) => z.hp > 0 && z.x > -2 && z.x < 12);
    const alivePlants = this.plants.length;
    // 玉米炮一半被吃掉时，配对的另一半也要一起移除。
    const deadPairs = new Set(
      this.plants.filter((p) => p.hp <= 0 && p.pair).map((p) => p.pair!),
    );
    this.plants = this.plants.filter(
      (p) => p.hp > 0 && !deadPairs.has(p.uid),
    );
    this.plantsLost += alivePlants - this.plants.length;
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
      // Victory slow-mo: hold the win for a beat; scene drops the pace meanwhile.
      if (this.winDelay < 0) {
        this.winDelay = 0.35;
        this.say("庭院守住了！");
      }
      this.winDelay -= dt;
      if (this.winDelay <= 0) this.status = "won";
    }
  }
  updateZombie(z: Zombie, dt: number) {
    const previous = z.action,
      frozen = z.freeze > 0,
      clock = dt * (z.slow > 0 ? 0.5 : 1);
    this.advanceZombie(z, dt);
    if (z.action !== previous) z.actionTime = 0;
    else if (!frozen) z.actionTime = (z.actionTime ?? 0) + clock;
  }
  private advanceZombie(z: Zombie, dt: number) {
    if (z.hp <= 0) return;
    const d = zombieById[z.id];
    const slowed = z.slow > 0, clock = dt * (slowed ? 0.5 : 1);
    const frozen = z.freeze > 0;
    tickControls(z, dt);
    if (frozen) return;
    z.hurt = Math.max(0, (z.hurt || 0) - dt);
    if (z.laneChange) {
      z.laneChange.elapsed += dt;
      if (z.laneChange.elapsed >= 0.6) z.laneChange = undefined;
    }
    z.age += dt;
    z.timer -= clock;
    z.action = "walk";
    if (z.jump) {
      z.action = "jump";
      z.jump.elapsed = Math.min(z.jump.duration, z.jump.elapsed + clock);
      const progress = z.jump.elapsed / z.jump.duration;
      z.x = z.jump.from + (z.jump.to - z.jump.from) * progress;
      if (progress >= 1) {
        z.jump = undefined;
        z.action = "walk";
        this.effect(z.x, z.row, "land");
      }
      return;
    }
    if (z.special) {
      z.action = "special";
      const action = z.special;
      action.elapsed = Math.min(action.duration, action.elapsed + clock);
      if (!action.hit && action.elapsed >= action.duration * 0.5) {
        action.hit = true;
        if (action.kind === "summon") {
          for (const row of [z.row - 1, z.row + 1]) {
            if (row < 0 || row >= this.level.rows || this.water(row)) continue;
            this.spawn("backup", row, z.x);
            const dancer = this.zombies.at(-1)!;
            dancer.ally = z.ally;
            dancer.reverse = z.reverse;
            this.effect(z.x, row, "land", "backup");
          }
        } else if (action.kind === "throw") {
          this.spawn("imp", z.row, z.x);
          const imp = this.zombies.at(-1)!;
          imp.ally = z.ally;
          imp.reverse = z.reverse;
          imp.jump = {
            from: z.x,
            to: Math.max(0, Math.min(9.5, z.x + (z.reverse ? 4 : -4))),
            elapsed: 0,
            duration: 1.1,
            kind: "throw",
            fromHeight: 60,
          };
          imp.action = "jump";
          this.effect(z.x, z.row, "jump", "garg");
        } else {
          if (action.opponent) {
            const victim = this.zombies.find(
              (q) =>
                q.uid === action.target &&
                q.hp > 0 &&
                q.ally !== z.ally &&
                q.row === z.row &&
                Math.abs(q.x - z.x) < 0.7,
            );
            if (victim) this.damage(victim, 9999);
          } else {
            const victim = this.plants.find(
              (p) =>
                p.uid === action.target &&
                p.hp > 0 &&
                p.row === z.row &&
                Math.abs(p.col - z.x) < 0.7,
            );
            if (victim) victim.hp = 0;
          }
          this.effect(z.x - 0.35, z.row, "smash", "garg");
        }
      }
      if (action.elapsed >= action.duration) {
        z.special = undefined;
        z.action = "walk";
      }
      return;
    }
    if (Math.floor((z.age - dt) / 8) !== Math.floor(z.age / 8))
      this.sound("groan", z.x, z.id);
    if (z.id === "bungee") {
      z.action = "special";
      if (z.age > 5) {
        const p = this.at(z.row, Math.round(z.x), "main");
        if (p && !z.ally && !this.protected(z.row, z.x)) this.remove(p, true);
        z.hp = 0;
      }
      return;
    }
    if (
      z.id === "jack" &&
      !z.disarmed &&
      z.age > 15 &&
      this.random() < dt * 0.2
    ) {
      if (z.ally) {
        for (const enemy of this.zombies)
          if (!enemy.ally && Math.abs(enemy.row - z.row) <= 1 && Math.abs(enemy.x - z.x) < 1.5)
            this.damage(enemy, 1800, true);
      } else {
        for (const p of [...this.plants])
          if (Math.abs(p.row - z.row) <= 1 && Math.abs(p.col - z.x) < 1.5)
            this.remove(p, true);
      }
      this.effect(z.x, z.row, "boom");
      z.hp = 0;
      return;
    }
    if (z.id === "dancer" && z.timer <= 0) {
      z.timer = 18;
      z.special = { kind: "summon", elapsed: 0, duration: 0.9, hit: false };
      z.action = "special";
      return;
    }
    if (z.id === "garg" && z.hp < z.max / 2 && !z.thrown) {
      z.thrown = true;
      z.special = { kind: "throw", elapsed: 0, duration: 0.9, hit: false };
      z.action = "special";
      return;
    }
    if (z.id === "catapult" && !z.ally && z.x > 7 && z.age < 30) {
      z.action = "special";
      if (z.timer <= 0) {
        const p = this.plants.find(
          (p) => p.hp > 0 && p.row === z.row && p.layer === "main",
        );
        if (p && !this.protected(p.row, p.col)) {
          p.hp -= 100;
          p.hurt = 0.16;
          this.effect(p.col, p.row, "hit");
        }
        z.timer = 3;
      }
      return;
    }
    if (z.underground && z.x < 0.1) {
      z.underground = false;
      z.reverse = true;
      applyControl(z, "otherFreeze", 2);
    }
    if (z.id === "yeti" && z.age > 15) z.reverse = true;
    const opponent = this.zombies.find(
      (q) =>
        q.hp > 0 &&
        q.ally !== z.ally &&
        q.row === z.row &&
        !q.flying &&
        !q.underground &&
        Math.abs(q.x - z.x) < 0.5,
    );
    if (opponent && !z.flying && !z.underground) {
      if (z.id === "garg") {
        if (z.timer <= 0) {
          z.special = {
            kind: "smash",
            elapsed: 0,
            duration: 0.8,
            hit: false,
            target: opponent.uid,
            opponent: true,
          };
          z.timer = 2;
          z.action = "special";
        } else z.action = "eat";
        return;
      }
      z.action = "eat";
      if (z.timer <= 0) {
        this.damage(opponent, 100);
        z.timer = 1;
        this.effect(z.x, z.row, "bite", z.id);
      }
      return;
    }
    const target = this.plants
      .filter(
        (p) =>
          p.row === z.row &&
          p.hp > 0 &&
          Math.abs(p.col - z.x) < 0.45 &&
          plantById[p.id].kind !== "spike",
      )
      .sort(
        (a, b) =>
          ({ armor: 0, main: 1, base: 2 })[a.layer] -
          { armor: 0, main: 1, base: 2 }[b.layer],
      )[0];
    if (target && !z.flying && !z.underground && !z.ally) {
      if (z.id === "garg") {
        if (z.timer <= 0) {
          z.special = {
            kind: "smash",
            elapsed: 0,
            duration: 0.8,
            hit: false,
            target: target.uid,
          };
          z.timer = 2;
          z.action = "special";
        } else z.action = "eat";
        return;
      }
      if (
        target.ladder ||
        (z.id === "ladder" &&
          !z.jumped &&
          (target.layer === "armor" || plantById[target.id].kind === "wall"))
      ) {
        target.ladder = true;
        z.jumped = true;
        z.jump = { from: z.x, to: z.x - 1, elapsed: 0, duration: 0.7, kind: "ladder" };
        z.action = "jump";
        this.effect(z.x, z.row, "jump");
        return;
      }
      if (
        ["pole", "dolphin", "pogo"].includes(z.id) &&
        !z.jumped &&
        target.id !== "tallnut"
      ) {
        z.jump = { from: z.x, to: z.x - 1.25, elapsed: 0, duration: 0.85, kind: "vault", fromHeight: jumpHeight(z) };
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
          if (choices.length) {
            z.laneChange = { from: z.row, elapsed: 0 };
            z.row = choices[Math.floor(this.random() * choices.length)];
          }
        }
        target.hp -= ["garg", "zomboni", "catapult"].includes(z.id)
          ? 9999
          : 100;
        target.hurt = 0.16;
        z.timer = ["garg"].includes(z.id) ? 2 : 1;
        this.effect(target.col, target.row, "bite", z.id);
      }
      return;
    }
    let speed = (d.speed / 96) * this.settings.speed * (z.boost ?? 1);
    if (z.id === "bobsled") {
      // 雪橇小队依赖冰道：在冰上快速推进，离开冰道就失去速度。
      const onIce = this.tiles.some(
        (t) =>
          t.type === "ice" && t.row === z.row && Math.abs(t.col - z.x) < 0.7,
      );
      speed *= onIce ? 1.6 : 0.35;
    }
    if (z.id === "paper" && z.armor === 0) speed *= 2.8;
    if (z.jumped && ["pole", "dolphin"].includes(z.id)) speed *= 0.5;
    if (slowed) speed *= 0.5;
    z.x += speed * dt * (z.reverse ? 1 : -1);
    if (
      this.level.mode === "normal" &&
      !z.ally &&
      !z.reverse &&
      z.x < 3.5 &&
      !this.mowers[z.row] &&
      !this.spareMowers[z.row] &&
      !this.alerted.has("danger")
    ) {
      this.alerted.add("danger");
      this.sound("danger");
      this.say("防线告急！有僵尸突破了中场", "alert");
    }
    const lastStep = Math.floor(z.motion / 12);
    z.motion += speed * dt * 96;
    if (
      Math.floor(z.motion / 12) !== lastStep &&
      !z.flying &&
      !z.underground &&
      ![
        "zomboni",
        "bobsled",
        "catapult",
        "ducky",
        "snorkel",
        "dolphin",
      ].includes(z.id)
    )
      this.sound("step", z.x, z.id);
    if (z.id === "zomboni" && z.x < 9) {
      const col = Math.round(z.x);
      if (!this.tiles.some((t) => t.row === z.row && t.col === col))
        this.tiles.push({ row: z.row, col, type: "ice", life: 60 });
    }
    if (z.x < -0.65 && !z.ally) {
      if (this.mowers[z.row] || this.spareMowers[z.row]) {
        this.mowersLost++;
        if (this.mowers[z.row]) this.mowers[z.row] = false;
        else this.spareMowers[z.row] = false;
        for (const q of this.zombies) if (q.row === z.row && !q.ally) q.hp = 0;
        this.effect(0, z.row, "mower");
        this.say(this.spareMowers[z.row]
          ? "割草机出动！这一行还有一台备用车"
          : "割草机出动！这一行已失去最后的保护");
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
