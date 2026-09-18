<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  watchEffect,
  nextTick,
  markRaw,
} from "vue";
import {
  plants,
  plantById,
  zombies,
  worlds,
  levels,
  isMushroom,
  isNight,
  recommendCards,
  combatGuide,
} from "./game/content";
import type { PlantDef, ZombieDef } from "./game/content";
import {
  plantImage,
  zombieImage,
  gardenImage,
  bowlImage,
  tokenImage,
  uiIcon,
} from "./game/art";
import { battleSettings, defaultOptions } from "./game/difficulty";
import { applyDailyMods, dailyChallenge } from "./game/daily";
import { achievementDefs, checkAchievements } from "./achievements";
import { Engine } from "./game/engine";
import { levelCleared, nextReplayAttempt } from "./game/replay";
import { mountGame } from "./game/scene";
import { GardenAudio } from "./game/audio";
import type { SoundKind } from "./game/audio";
import {
  BASE_SEED_SLOTS,
  MAX_SEED_SLOTS,
  seedSlotPriceFor,
  totalSeedSlots,
  useSave,
} from "./store";
import { useAuth } from "./auth";
const save = useSave();
const auth = useAuth();
save.load();
// 会话恢复（Cookie 仍有效）时也必须先对账再允许云推送，否则旧本机档会覆盖云端新档。
void (async () => {
  await auth.refresh();
  if (auth.loggedIn) await save.reconcile();
  else save.reconciled = true;
})();
{
  const fresh = checkAchievements(save.data);
  if (fresh.length) {
    save.data.achievements.push(...fresh.map((a) => a.id));
    save.persist();
  }
}
const page = ref<"home" | "select" | "game">("home"),
  modal = ref(""),
  tab = ref("plants"),
  world = ref(0),
  levelId = ref(Math.min(50, save.data.unlocked));
const chosen = ref<string[]>([]),
  gameEl = ref<HTMLElement>(),
  tick = ref(0),
  engine = ref<Engine>(),
  playing = ref(false),
  result = ref(""),
  resultStars = ref(0),
  loseTip = ref(""),
  denied = ref(""),
  dailyMode = ref(false),
  dailySalt = ref(0),
  dailyOfficial = ref(true),
  newAchievements = ref<string[]>([]),
  full = ref(false),
  file = ref<HTMLInputElement>(),
  imitate = ref("pea"),
  booting = ref(false),
  bootError = ref("");
// 移动端方向与全屏：手机竖屏改用旋转引导，横屏让战场吃满可视高度。
const viewport = ref({ w: window.innerWidth, h: window.innerHeight });
const allowPortraitPlay = ref(false);
const standalone = ref(false);
const installTip = ref(false);
const isPortrait = computed(() => viewport.value.h > viewport.value.w);
const isPhone = computed(
  () => Math.min(viewport.value.w, viewport.value.h) <= 620,
);
const touchDevice =
  typeof navigator !== "undefined" &&
  typeof window !== "undefined" &&
  (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
const portraitGate = computed(
  () =>
    page.value === "game" &&
    isPortrait.value &&
    isPhone.value &&
    touchDevice &&
    !allowPortraitPlay.value,
);
// 竖屏引导盖住画面时必须暂停规则，否则僵尸会在玩家无法操作时继续推进。
let gatePaused = false;
watch(portraitGate, (active) => {
  const e = engine.value;
  if (!e || e.status !== "playing") {
    gatePaused = false;
    return;
  }
  if (active) {
    if (!e.paused) {
      e.paused = true;
      gatePaused = true;
    }
  } else if (gatePaused) {
    e.paused = false;
    gatePaused = false;
  }
});
const isIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let game: Awaited<ReturnType<typeof mountGame>> | undefined;
let gameGeneration = 0,
  starting = false,
  viewportTimer = 0;
let boardObserver: ResizeObserver | undefined;
let lastRestartKey = -1e9;
const audio = new GardenAudio();
const lessonOpen = ref(false);
let settled = false;
const level = computed(() => levels[levelId.value - 1]);
const available = computed(() =>
  plants.filter((p) => p.unlock <= save.data.unlocked),
);
// 卡槽只由商店扩容决定：基础 6，最多 10（规则方案 A，不再随章节免费增加）。
const slots = computed(() => totalSeedSlots(save.data.seedSlots));
const garden = computed(() => gardenImage(level.value.scene));
const levelHint = computed(() => {
  const l = level.value;
  if (l.id === 1) return "第一关只有豌豆射手：先点落下的阳光，再守住路线。";
  if (l.world === 1) return "夜间没有自然掉落的阳光。记得带上阳光菇。";
  if (l.world === 3) return l.mode === "vases"
    ? "全场可见：先辨认冰、电标记罐，组合火力守住六条路线。"
    : "夜间泳池没有天降阳光。睡莲承载水路火力，路灯花照亮迷雾；留意气球与后方矿工。";
  if (l.world === 2)
    return "水路种植陆生植物前，需要先放置睡莲。";
  if (l.world === 4) return "屋顶需要花盆。投手的抛物线能越过斜坡。";
  return "先建立阳光生产，再用射手与坚果搭起防线。";
});
const seedNeeds = computed(() => {
  const l = level.value;
  const needs: { label: string; ready: boolean }[] = [];
  if (l.mode !== "normal") return needs;
  if (l.id > 1) needs.push({ label: "阳光生产", ready: chosen.value.some(id => ["sunflower", "sunshroom", "twin"].includes(id)) });
  if (l.rows === 6) needs.push({ label: "水路 · 睡莲", ready: chosen.value.includes("lily") });
  if (l.scene === "roof") needs.push({ label: "屋顶 · 花盆", ready: chosen.value.includes("pot") });
  if (l.scene === "fog") needs.push({ label: "照明 · 路灯花", ready: chosen.value.includes("lantern") });
  if (l.enemies.includes("balloon")) needs.push({ label: "防空", ready: chosen.value.some(id => ["cactus", "blover"].includes(id)) });
  return needs;
});
const previewSettings = computed(() =>
  battleSettings(level.value, save.data.options),
);
const modeNames = {
  casual: "休闲",
  standard: "标准",
  hard: "困难",
  custom: "自定义",
};
const gardenTips = [
  {
    img: "sunflower",
    text: "先种向日葵。充足的阳光，是好防线的开始。",
  },
  {
    img: "sunshroom",
    text: "夜间没有自然掉落的阳光，记得带上阳光菇。",
  },
  {
    img: "fume",
    text: "大喷菇能越过铁栅门，但打不穿铁桶和橄榄球头盔。",
  },
  {
    img: "magnet",
    text: "磁力菇能吸走铁桶、橄榄球头盔和玩偶匣。",
  },
  {
    img: "cactus",
    text: "仙人掌能击落气球僵尸，香蒲也能自动追踪空中目标。",
  },
  {
    img: "tallnut",
    text: "高坚果能挡住撑杆僵尸和海豚骑士的跳跃。",
  },
  {
    img: "umbrella",
    text: "叶子保护伞能防蹦极偷植物和投石车的篮球。",
  },
  {
    img: "ice",
    text: "寒冰菇能熄灭火球，火爆辣椒能融化同一行的冰球。",
  },
];
const tipIndex = ref(0);
let tipTimer: number | undefined;
function nextTip() {
  tipIndex.value = (tipIndex.value + 1) % gardenTips.length;
}
function startTipTimer() {
  stopTipTimer();
  tipTimer = window.setInterval(nextTip, 6000);
}
function stopTipTimer() {
  if (tipTimer) {
    window.clearInterval(tipTimer);
    tipTimer = undefined;
  }
}
function updateSettings() {
  audio.volume = save.data.volume;
  audio.mix = { ...save.data.mix };
  save.persist();
}
function sampleSound() {
  void audio.unlock().then(() => audio.play("groan"));
}
function sampleChannel(channel: string) {
  const kind = { battle: "pea", music: "music", environment: "ambient", ui: "sun" }[
    channel
  ] as SoundKind | undefined;
  if (kind) void audio.unlock().then(() => audio.play(kind));
}
function resetDifficulty() {
  save.data.options = defaultOptions();
  save.persist();
}
const stats = computed(() => {
  void tick.value;
  const e = engine.value;
  return {
    toolUses: e?.toolUses ?? 0,
    toolSource: e?.toolSource ?? 0,
    toolHint: e?.toolHint ?? "",
    hammer: e?.hammer ?? "ice",
    reactions: e?.reactions ?? 0,
    fogSeconds: e?.level.scene === "fog" && e.level.mode !== "vases" ? Math.ceil(e.fogClear) : 0,
    weather: e && e.windUntil > e.time ? "寒风" : e && e.rainUntil > e.time ? "阳光雨" : "",
    weatherSeconds: e ? Math.ceil(Math.max(e.windUntil, e.rainUntil) - e.time) : 0,
    sun: e?.sun || 0,
    selected: e?.selected || "",
    paused: e?.paused || false,
    progress: e ? Math.min(100, (e.wave / e.totalWaves) * 100) : 0,
    message: e && e.time < e.messageUntil ? e.message : "",
    alert: !!(e && e.time < e.messageUntil && e.messageTone === "alert"),
    coins: e?.coins || 0,
    belt: e?.conveyor || [],
    cooldowns: { ...e?.cooldowns },
    time: Math.floor(e?.time || 0),
    boss: e?.bossHp || 0,
    wave: e?.wave || 0,
    totalWaves: e?.totalWaves || 0,
    nextWave: Math.ceil(e?.nextWaveIn || 0),
  };
});
const lesson = computed(() => {
  const e = engine.value;
  if (!e || !e.toolsUnlocked) return null;
  const mode = e.level.mode;
  if (mode === "bowling") return { id: "elements-bowling", title: "先冰后电，让坚果拐个弯", text: "冰球减速，电球命中冰系目标会爆发并向邻排传导。选「滚球换排」，点一颗球，再点相邻排；每局 3 次，球不会停下来等你。" };
  if (mode === "whack") return { id: "elements-whack", title: "冰锤铺路，电锤收场", text: "切换冰锤（20 伤害、冻结 3 秒）和电锤（120 伤害）。先冰后电触发爆发，两锤共享 0.4 秒间隔。紧急冰冻可冻结所选九宫格，每局 3 次。" };
  if (mode === "vases") return { id: "elements-vases", title: "认准两只组合罐", text: "带冰、电植物标记的罐子各藏一张种子卡，点击开罐后再种植。其他罐子仍有惊喜和危险。移植能调整阵型；水路先种睡莲。" };
  if (mode === "boss") return { id: "elements-boss", title: "用冰电清理召唤物", text: "冰、电植物随机供给，不保证配齐。组合只伤害召唤物，不能伤害僵王本体。继续保留寒冰菇和火爆辣椒应对冰火球；移植每局 3 次。" };
  if (e.isBelt) return { id: "elements-belt", title: "随机来牌，灵活配合", text: "传送带加入寒冰射手与电弧花，不保证成对出现。配齐时消耗冰系控制换取爆发；没配齐仍可按原阵容防守。移植每局 3 次，水路与屋顶需要底座。" };
  if (e.level.id >= 8 || e.cards.includes("arc")) return { id: "elements-arc", title: "冰电爆发，控制换伤害", text: "电弧花需要 225 阳光。平时单体电击；命中冰系目标时，解除其冰系控制、追加 100 伤害，并向附近至多 3 个敌人各传导 40 伤害；同一目标 4 秒内只能爆发一次。移植带走主植物和南瓜，每局 3 次。" };
  return { id: "elements-transplant", title: "给防线一次挪动的机会", text: "选「移植」，点主植物，再点绿色空格。每局免费 3 次，成功才扣次数；保留血量与冷却，南瓜一起搬，睡莲和花盆留在原地。再点工具或按 Esc 可取消。" };
});
function closeLesson() {
  if (lesson.value && !save.data.tutorialSeen.includes(lesson.value.id)) {
    save.data.tutorialSeen.push(lesson.value.id);
    save.persist();
  }
  lessonOpen.value = false;
  if (engine.value) engine.value.paused = false;
  tick.value++;
}
function showLesson() {
  if (!engine.value || engine.value.status !== "playing") return;
  lessonOpen.value = true;
  engine.value.paused = true;
  tick.value++;
}
function useGardenTool() { engine.value?.selectTool(); tick.value++; }
function chooseHammer(kind: "ice" | "electric") { engine.value?.selectHammer(kind); tick.value++; }
function seedName(id: string) {
  return engine.value?.level.mode === "bowling" && id === "snowpea" ? "寒冰球" :
    engine.value?.level.mode === "bowling" && id === "arc" ? "电球" : plantById[id].name;
}
function seedPortrait(id: string) {
  return engine.value?.level.mode === "bowling" && ["snowpea", "arc"].includes(id) ?
    bowlImage(id === "snowpea" ? "ice" : "electric") : plantImage(id);
}
const pa = plantImage,
  za = zombieImage;
const tip = (item: PlantDef | ZombieDef) => ("tip" in item ? item.tip : "");
const counterNames = (item: PlantDef | ZombieDef) =>
  "counters" in item && item.counters.length
    ? item.counters.map((id) => plantById[id].name).join("、")
    : "";
const loseTips = [
  "试试把坚果放在更靠前的位置。",
  "多种几株向日葵，阳光充足才有底气。",
  "寒冰射手能拖慢僵尸，为防线争取时间。",
  "土豆地雷便宜又实用，开局先埋几颗。",
];
const daily = computed(() =>
  dailyChallenge(new Date(), save.data.unlocked, dailySalt.value),
);
// 战斗中的种子栏与关卡信息：每日挑战使用每日卡池与每日关卡，而不是冒险选卡。
const battleCards = computed(() =>
  dailyMode.value ? daily.value.cards : chosen.value,
);
const battleLevel = computed(() => engine.value?.level ?? level.value);
const recommended = computed(() => new Set(
  recommendCards(level.value, available.value.map(p => p.id), slots.value),
));
// 夜晚与迷雾关没有天降阳光，向日葵类生产效率降低，选卡界面给出提示。
const lowSun = computed(
  () => new Set(isNight(level.value.scene) ? ["sunflower", "twin"] : []),
);
const bestTimes = computed(() => {
  const map: Record<number, number> = {};
  for (const s of save.data.scores)
    if (s.difficulty !== "custom" && s.seconds < (map[s.level] ?? Infinity))
      map[s.level] = s.seconds;
  return map;
});
const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
function switchDifficulty(d: "casual" | "standard" | "hard") {
  save.data.options.difficulty = d;
  save.persist();
  void start();
}
const guideAnchor = computed(() => {
  void tick.value;
  const e = engine.value;
  if (!e || e.level.id > 3 || e.time >= e.messageUntil) return "";
  if (e.message.includes("落下的阳光") || e.message.includes("阳光不足"))
    return "sun";
  if (e.message.includes("种射手")) return "seeds";
  return "";
});
const demoId = ref(""),
  demoEl = ref<HTMLElement>();
let demoGame: Awaited<ReturnType<typeof mountGame>> | undefined,
  demoTimer = 0,
  demoCount = 0,
  demoGeneration = 0;
const demoable = (item: PlantDef | ZombieDef) =>
  "cost" in item &&
  !item.upgrade &&
  !["lily", "pot", "sea", "kelp", "coffee", "grave", "imitater"].includes(
    item.id,
  );
async function openDemo(id: string) {
  closeDemo();
  const generation = demoGeneration;
  demoId.value = id;
  await nextTick();
  if (generation !== demoGeneration || !demoEl.value) return;
  const night = isMushroom(id);
  const e = markRaw(new Engine(night ? 11 : 1, [], (night ? 11 : 1) * 719));
  e.schedule = [];
  e.addPlant(id, 2, 3);
  // Keep a target in the demonstrated plant's lane so a short preview fires.
  e.spawn("basic", 2, 7);
  demoCount = 0;
  const mounted = await mountGame(
    demoEl.value!,
    e,
    () => {
      if (generation !== demoGeneration) return;
      demoCount++;
      if (demoCount % 31 === 0) e.spawn("basic", 2, 7);
      if (demoCount % 13 === 0 && !e.plants.some((p) => p.id === id))
        e.addPlant(id, 2, 3);
    },
    {},
  );
  if (generation !== demoGeneration) {
    mounted.destroy(true);
    return;
  }
  demoGame = mounted;
  demoTimer = window.setTimeout(closeDemo, 10000);
}
function closeDemo() {
  demoGeneration++;
  clearTimeout(demoTimer);
  demoGame?.destroy(true);
  demoGame = undefined;
  demoId.value = "";
}
const shopItems = [
  {
    id: "sun-boost",
    name: "应急阳光",
    price: 150,
    desc: "下一局开局阳光 +75。",
    img: "sunflower",
  },
  {
    id: "spare-mower",
    name: "备用小推车",
    price: 200,
    desc: "下一局每行多一台备用小推车。",
    img: "mower",
  },
];
const coinArt = tokenImage("token-coin");
const seedSlotPrice = computed(() => seedSlotPriceFor(save.data.seedSlots));
const seedSlotsFull = computed(() => slots.value >= MAX_SEED_SLOTS);
const shopAffordable = computed(
  () =>
    shopItems.some((i) => save.data.coins >= i.price) ||
    (!seedSlotsFull.value && save.data.coins >= seedSlotPrice.value),
);
// 购买成功后给对应卡片一个短暂高亮脉冲。
const boughtPulse = ref("");
function markBought(id: string) {
  boughtPulse.value = id;
  window.setTimeout(() => {
    if (boughtPulse.value === id) boughtPulse.value = "";
  }, 600);
}
function buy(item: (typeof shopItems)[number]) {
  if (save.buyItem(item.id, item.price)) {
    audio.play("sun");
    markBought(item.id);
  }
}
function buySeedSlot() {
  if (seedSlotsFull.value || save.data.coins < seedSlotPrice.value) return;
  save.data.coins -= seedSlotPrice.value;
  save.data.seedSlots += 1;
  save.persist();
  audio.play("sun");
  markBought("seed-slot");
}
function startDaily() {
  // 主页入口固定用官方每日种子；“换一局”才使用随机盐。
  dailySalt.value = 0;
  dailyMode.value = true;
  void start();
}
function rerollDaily() {
  // 换一局：随机盐重抽关卡与卡池，成绩不计入官方最佳。
  dailySalt.value = (Math.random() * 0xffffffff) >>> 0;
  dailyMode.value = true;
  void start();
}
function chooseLevel(id: number) {
  gameGeneration++;
  starting = false;
  void exitBattleFullscreen();
  audio.stop();
  game?.destroy(true);
  game = undefined;
  boardObserver?.disconnect();
  boardObserver = undefined;
  engine.value = undefined;
  playing.value = false;
  booting.value = false;
  bootError.value = "";
  result.value = "";
  resultStars.value = 0;
  newAchievements.value = [];
  dailyMode.value = false;
  allowPortraitPlay.value = false;
  gatePaused = false;
  levelId.value = id;
  modal.value = "";
  const unlocked = available.value.map((p) => p.id);
  chosen.value = recommendCards(level.value, unlocked, slots.value);
  page.value = "select";
  window.scrollTo(0, 0);
  audio.play("click");
}
function toggle(id: string) {
  if (chosen.value.includes(id)) {
    chosen.value = chosen.value.filter((x) => x !== id);
    audio.play("click");
  } else if (chosen.value.length < slots.value) {
    chosen.value.push(id);
    audio.play("click");
  } else {
    // 卡槽已满：与战斗中选卡失败一致，给抖动动画和拒绝音，不再播成功音。
    denied.value = "";
    requestAnimationFrame(() => (denied.value = id));
    setTimeout(() => {
      if (denied.value === id) denied.value = "";
    }, 450);
    audio.play("denied");
  }
}
async function start() {
  const d = dailyMode.value ? daily.value : null;
  if (starting || (!d && !chosen.value.length)) return;
  starting = true;
  allowPortraitPlay.value = false;
  gatePaused = false;
  dailyOfficial.value = dailySalt.value === 0;
  bootError.value = "";
  const generation = ++gameGeneration;
  try {
    audio.stop();
    await audio.unlock();
    if (generation !== gameGeneration) return;
    save.persist();
    game?.destroy(true);
    engine.value = markRaw(
      new Engine(
        d ? d.levelId : levelId.value,
        d ? d.cards : [...chosen.value],
        d ? d.seed : levelId.value * 719,
        d ? d.options : save.data.options,
      ),
    );
    if (d) applyDailyMods(engine.value, d.mods);
    // 重玩/雪人判定在 UI 层完成并显式写入引擎；每日挑战恒为 false，
    // 保证同一种子对所有玩家、任何存档状态都一致。
    engine.value.replay = d ? false : levelCleared(levelId.value);
    if (engine.value.replay) engine.value.replayAttempt = nextReplayAttempt(levelId.value);
    engine.value.imitate = imitate.value;
    engine.value.toolsUnlocked ||= save.data.unlocked >= 5;
    const items = save.data.items;
    let usedItem = false;
    if ((items["sun-boost"] ?? 0) > 0) {
      items["sun-boost"]--;
      engine.value.sun += 75;
      usedItem = true;
    }
    if ((items["spare-mower"] ?? 0) > 0 && engine.value.settings.mowers) {
      items["spare-mower"]--;
      engine.value.spareMowers.fill(true);
      usedItem = true;
    }
    if (usedItem) save.persist();

    settled = false;
    result.value = "";
    resultStars.value = 0;
    newAchievements.value = [];
    page.value = "game";
    playing.value = true;
    lessonOpen.value = !!lesson.value && !save.data.tutorialSeen.includes(lesson.value.id);
    engine.value.paused = lessonOpen.value;
    booting.value = true;
    await nextTick();
    if (generation !== gameGeneration || !gameEl.value) {
      booting.value = false;
      return;
    }
    window.scrollTo(0, 0);
    let mounted: Awaited<ReturnType<typeof mountGame>>;
    try {
      // 首次进入要动态加载 Phaser 与贴图；加载失败（网络 404、WebGL 不可用等）
      // 不能静默白屏，要给出可重试的错误提示。
      mounted = await mountGame(
        gameEl.value!,
        engine.value,
        () => {
        if (generation !== gameGeneration) return;
        tick.value++;
        const e = engine.value!;

        if (e.status !== "playing" && !settled) {
          settled = true;
          result.value = e.status;
          save.data.kills += e.kills;
          const mowersIntact = e.mowersLost === 0;
          if (e.status === "won") {
            if (dailyMode.value) {
              // 每日挑战不结算金币，只记最佳成绩。
              if (dailyOfficial.value) save.recordDaily(daily.value.date, e.time);
            } else if (e.settings.difficulty !== "custom") {
              save.win(levelId.value, e.coins);
              // 第三颗星要求速通：最后一波固定在 duration - 45 秒刷完
              // （见 difficulty.ts 的 makeWaves），胜利时刻必然晚于它。
              // 以末波刷完时刻为基准给 75 秒清场宽限：实测自动玩家在多数
              // 关卡的末波清场约 12~107 秒，75 秒让防线扎实的玩家可稳定
              // 达成，又对拖沓的残局保留区分度；对齐 duration（45 秒宽限）
              // 则达标与否取决于那段不受玩家控制的尾巴，像掷硬币。
              const starDeadline = e.settings.duration - 45 + 75;
              resultStars.value =
                1 +
                (mowersIntact ? 1 : 0) +
                (e.time <= starDeadline ? 1 : 0);
              save.recordStars(levelId.value, resultStars.value);
            } else {
              // 自定义模式不解锁关卡，金币照常入账。
              save.addCoins(e.coins);
            }
            if (!dailyMode.value) save.record(levelId.value, e.time, e.settings);
            audio.play("win");
          } else {
            loseTip.value =
              loseTips[Math.floor(Math.random() * loseTips.length)];
            if (!dailyMode.value) save.recordLoss(levelId.value);
            audio.play("lose");
          }
          const fresh = checkAchievements(
            save.data,
            e.status === "won"
              ? {
                  coins: e.coins,
                  difficulty: e.settings.difficulty,
                  mowersIntact,
                }
              : undefined,
          );
          if (fresh.length) {
            save.data.achievements.push(...fresh.map((a) => a.id));
            newAchievements.value = fresh.map((a) => a.name);
          }
          save.persist();
        }
      },
      {
        audio, quality: () => save.data.quality, shake: () => save.data.shake, contrast: () => save.data.contrast,
        pickupTarget: (coin) => {
          const canvas = gameEl.value?.querySelector("canvas")?.getBoundingClientRect();
          const badge = document.querySelector(coin ? ".coin-counter" : ".seed-tray .sun-counter")?.getBoundingClientRect();
          if (!canvas?.width || !badge) return undefined;
          return { x: (badge.left + badge.width / 2 - canvas.left) * 1200 / canvas.width, y: 0 };
        },
      },
      );
    } catch (error) {
      // 挂载失败（资源 404、WebGL 不可用等）：回到可操作的错误界面，
      // 不留空白页；此时还没有创建出 Phaser 实例，无需销毁。
      if (generation !== gameGeneration) return;
      console.error("游戏挂载失败", error);
      booting.value = false;
      playing.value = false;
      lessonOpen.value = false;
      bootError.value =
        "游戏资源加载失败，可能是网络不稳定，或当前浏览器不支持 WebGL。";
      return;
    }
    booting.value = false;
    if (generation === gameGeneration) {
      game = mounted;
      observeBoard();
      syncViewport();
    } else mounted.destroy(true);
  } finally {
    if (generation === gameGeneration) starting = false;
  }
}
function home() {
  gameGeneration++;
  starting = false;
  void exitBattleFullscreen();
  audio.stop();
  game?.destroy(true);
  game = undefined;
  boardObserver?.disconnect();
  boardObserver = undefined;
  engine.value = undefined;
  page.value = "home";
  playing.value = false;
  booting.value = false;
  bootError.value = "";
  result.value = "";
  dailyMode.value = false;
  modal.value = "";
}
function speed() {
  const e = engine.value;
  if (!e) return;
  e.timeScale = e.timeScale === 1 ? 2 : 1;
  tick.value++;
  audio.play("click");
}
const flagMarks = computed(() => {
  const e = engine.value;
  if (!e || !e.schedule.length) return [];
  const seen = new Set<number>(),
    marks: number[] = [];
  for (const ev of e.schedule) {
    if ((ev.wave % 4 === 0 || ev.wave === e.totalWaves) && !seen.has(ev.wave)) {
      seen.add(ev.wave);
      marks.push((ev.at / e.settings.duration) * 100);
    }
  }
  return marks;
});
function selectSeed(id: string) {
  const e = engine.value;
  if (!e || e.paused || e.status !== "playing") return;
  if (e.level.mode === "whack") return;
  if (
    id !== "shovel" &&
    !e.isBelt &&
    (e.sun < e.getDef(id).cost || e.cooldowns[id] > 0)
  ) {
    denied.value = "";
    requestAnimationFrame(() => (denied.value = id));
    setTimeout(() => {
      if (denied.value === id) denied.value = "";
    }, 450);
    audio.play("denied");
    return;
  }
  const selected = e.selected === id;
  e.cancelSelection();
  e.selected = selected ? "" : id;
  tick.value++;
  audio.play("click");
}
// 按下卡片就选中，这样直接从卡片拖到草坪时也能看到落点预览；
// 随后的 click 只负责“再点一次取消选择”。
let seededByPress = false;
function seedDown(id: string) {
  const e = engine.value;
  seededByPress = false;
  if (!e || e.paused || e.status !== "playing") return;
  if (e.level.mode === "whack") return;
  if (id === "shovel" || e.selected === id) {
    seededByPress = false;
    return;
  }
  if (!e.isBelt && (e.sun < e.getDef(id).cost || e.cooldowns[id] > 0)) {
    seededByPress = false;
    return;
  }
  e.cancelSelection();
  e.selected = id;
  seededByPress = true;
  tick.value++;
}
function seedClick(id: string) {
  if (seededByPress) {
    seededByPress = false;
    return;
  }
  selectSeed(id);
}
function pause() {
  if (engine.value?.status === "playing" && !lessonOpen.value) {
    engine.value.paused = !engine.value.paused;
    if (engine.value.paused) audio.stop();
    else void audio.unlock();
    tick.value++;
  }
}
const authName = ref("");
const authPassword = ref("");
const authMode = ref<"login" | "register">("login");
const userName = computed(() => auth.user?.name ?? "");
const cloudLabel = computed(() => {
  if (!auth.loggedIn) return "未登录";
  if (save.cloud === "syncing") return "同步中…";
  if (save.cloud === "synced") return "已同步";
  if (save.cloud === "error") return "同步失败";
  return "等待同步";
});
function openAccount(mode: "login" | "register") {
  authMode.value = mode;
  auth.error = "";
  modal.value = "account";
  if (engine.value) engine.value.paused = true;
}
async function submitAuth() {
  const ok =
    authMode.value === "login"
      ? await auth.login(authName.value, authPassword.value)
      : await auth.register(authName.value, authPassword.value);
  if (!ok) return;
  authPassword.value = "";
  modal.value = "";
  await save.reconcile();
  audio.enabled = save.data.sound;
  audio.volume = save.data.volume;
  audio.mix = { ...save.data.mix };
  levelId.value = Math.min(50, save.data.unlocked);
}
async function signOut() {
  await auth.logout();
  save.warning = "已退出登录，进度仍保存在本机。";
}
async function uploadSave() {
  await save.pushCloud(true);
}
async function downloadSave() {
  await save.pullCloud();
}
function exportSave() {
  const blob = new Blob([JSON.stringify(save.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "庭院保卫战-存档.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importSave(event: Event) {
  const f = (event.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    if (f.size > 100000) throw Error("存档文件过大");
    save.importSave(await f.text());
    audio.enabled = save.data.sound;
    audio.volume = save.data.volume;
    audio.mix = { ...save.data.mix };
    levelId.value = Math.min(50, save.data.unlocked);
  } catch (error) {
    save.warning = (error as Error).message;
  }
  if (file.value) file.value.value = "";
}
function sound() {
  save.data.sound = !save.data.sound;
  audio.enabled = save.data.sound;
  save.persist();
  audio.play("click");
}
async function exitBattleFullscreen() {
  full.value = false;
  installTip.value = false;
  if (document.fullscreenElement)
    await document.exitFullscreen().catch(() => {});
  try {
    screen.orientation?.unlock();
  } catch {
    /* Optional browser API. */
  }
  syncViewport();
}
async function fullscreen() {
  if (full.value) {
    await exitBattleFullscreen();
    return;
  }
  full.value = true;
  await nextTick();
  let native = false;
  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
      native = true;
    }
  } catch {
    /* Keep immersive layout when native fullscreen is unavailable. */
  }
  try {
    await (
      screen.orientation as ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>;
      }
    ).lock?.("landscape");
  } catch {
    /* Manual landscape remains supported. */
  }
  // iPhone Safari 不支持网页元素全屏：引导“添加到主屏幕”，从桌面图标启动才是无地址栏的真全屏。
  if (!native && isIOS && !standalone.value) installTip.value = true;
  syncViewport();
}
/** 旋转引导里的“尝试全屏 / 旋转”：只请求，不因已在沉浸模式就把全屏关掉。 */
async function tryRotate() {
  let native = !!document.fullscreenElement;
  try {
    if (!native && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
      native = true;
    }
  } catch {
    /* Keep immersive layout when native fullscreen is unavailable. */
  }
  try {
    await (
      screen.orientation as ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>;
      }
    ).lock?.("landscape");
  } catch {
    /* iPhone 只能手动旋转。 */
  }
  if (!native && isIOS && !standalone.value) installTip.value = true;
  syncViewport();
}
function fullscreenChanged() {
  if (!document.fullscreenElement) full.value = false;
  syncViewport();
}
/** iOS 旋转、地址栏收放后布局会晚一拍，延迟通知 Phaser 重算画布。 */
function syncViewport() {
  viewport.value = { w: window.innerWidth, h: window.innerHeight };
  window.clearTimeout(viewportTimer);
  viewportTimer = window.setTimeout(refreshBoardScale, 250);
}
function refreshBoardScale() {
  window.dispatchEvent(new Event("resize"));
  game?.scale?.refresh?.();
  updateBoardVars();
}
/** 把画布在整屏里的真实矩形写进 CSS 变量，供浮动提示定位。 */
function updateBoardVars() {
  const canvas = gameEl.value?.querySelector("canvas");
  const frame = document.querySelector<HTMLElement>(".game-frame");
  if (!canvas || !frame) return;
  const c = canvas.getBoundingClientRect();
  const f = frame.getBoundingClientRect();
  frame.style.setProperty("--board-left", `${c.left - f.left}px`);
  frame.style.setProperty("--board-top", `${c.top - f.top}px`);
  frame.style.setProperty("--board-w", `${c.width}px`);
  frame.style.setProperty("--board-h", `${c.height}px`);
}
function observeBoard() {
  boardObserver?.disconnect();
  const frame = document.querySelector<HTMLElement>(".game-frame");
  const canvas = gameEl.value?.querySelector("canvas");
  if (!frame || !canvas) return;
  boardObserver = new ResizeObserver(updateBoardVars);
  boardObserver.observe(frame);
  boardObserver.observe(canvas);
  updateBoardVars();
}
watch(full, (value) => {
  document.body.classList.toggle("battle-fullscreen", value);
  void nextTick().then(() => window.dispatchEvent(new Event("resize")));
});
watchEffect(() => {
  document.body.classList.toggle("high-contrast", save.data.contrast);
  document.body.classList.toggle("font-small", save.data.fontSize === "small");
  document.body.classList.toggle("font-large", save.data.fontSize === "large");
});
let modalTrigger: HTMLElement | null = null;
watch(modal, (value, previous) => {
  if (!value) closeDemo();
  if (value && !previous) {
    modalTrigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    void nextTick().then(() => {
      document.querySelector<HTMLElement>(".modal .close")?.focus();
    });
  } else if (!value && previous) {
    if (modalTrigger?.isConnected) modalTrigger.focus();
    modalTrigger = null;
  }
});
function trapModalTab(e: KeyboardEvent) {
  const dialog = document.querySelector<HTMLElement>(".modal");
  if (!dialog) return;
  const focusables = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.getClientRects().length > 0);
  if (!focusables.length) return;
  const first = focusables[0],
    last = focusables[focusables.length - 1],
    active = document.activeElement;
  if (e.shiftKey && (active === first || !dialog.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
function visibility() {
  if (document.hidden && engine.value?.status === "playing") {
    engine.value.paused = true;
    audio.stop();
    tick.value++;
  }
}
function keyboard(e: KeyboardEvent) {
  // 弹窗打开时：Tab 循环限制在弹窗内；Esc 关闭弹窗（输入框内除外，保持原有提前返回）。
  if (modal.value && e.key === "Tab") {
    trapModalTab(e);
    return;
  }
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement
  )
    return;
  if (modal.value) {
    if (e.code === "Escape") modal.value = "";
    return;
  }
  if (page.value !== "game") return;
  if (e.code === "Space") {
    e.preventDefault();
    pause();
  }
  if (e.code === "Escape") {
    if (engine.value) {
      engine.value.cancelSelection();
    }
    if (full.value && !document.fullscreenElement) void exitBattleFullscreen();
    tick.value++;
  }
  if (e.key === "s" || e.key === "S") selectSeed("shovel");
  if (e.key.toLowerCase() === "f") void fullscreen();
  if (e.key.toLowerCase() === "t") useGardenTool();
  if (e.key.toLowerCase() === "q") chooseHammer("ice");
  if (e.key.toLowerCase() === "e") chooseHammer("electric");
  // 方向键唤出并移动草坪光标；回车在光标格种植/铲除/用工具，与指针同一入口。
  if (e.code.startsWith("Arrow") && engine.value) {
    const eng = engine.value;
    if (eng.status === "playing" && !eng.paused) {
      e.preventDefault();
      const [dRow, dCol] =
        e.code === "ArrowUp"
          ? [-1, 0]
          : e.code === "ArrowDown"
            ? [1, 0]
            : e.code === "ArrowLeft"
              ? [0, -1]
              : [0, 1];
      eng.moveCursor(dRow, dCol);
      tick.value++;
    }
  }
  if ((e.code === "Enter" || e.code === "NumpadEnter") && engine.value?.cursor) {
    const eng = engine.value;
    if (eng.status === "playing" && !eng.paused) {
      e.preventDefault();
      eng.cursorAction();
      tick.value++;
    }
  }
  if ((e.key === "r" || e.key === "R") && engine.value) {
    if (result.value || performance.now() - lastRestartKey < 3000) {
      // 重开触发后立刻清零确认窗口，否则 3 秒内第三次按 R 会跳过确认。
      lastRestartKey = -1e9;
      void start();
    } else {
      lastRestartKey = performance.now();
      engine.value.say("再按一次 R 重新开始本关");
    }
  }
  if (/^[0-9]$/.test(e.key)) {
    const ids = engine.value?.isBelt ? stats.value.belt : battleCards.value;
    const id = ids[e.key === "0" ? 9 : Number(e.key) - 1];
    if (id) selectSeed(id);
  }
}
onMounted(() => {
  audio.enabled = save.data.sound;
  audio.volume = save.data.volume;
  audio.mix = { ...save.data.mix };
  startTipTimer();
  standalone.value =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  syncViewport();
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("fullscreenchange", fullscreenChanged);
  window.addEventListener("orientationchange", syncViewport);
  window.visualViewport?.addEventListener("resize", syncViewport);
  try {
    screen.orientation?.addEventListener("change", syncViewport);
  } catch {
    /* Optional browser API. */
  }
  window.addEventListener("keydown", keyboard);
});
onBeforeUnmount(() => {
  gameGeneration++;
  game?.destroy(true);
  boardObserver?.disconnect();
  boardObserver = undefined;
  window.clearTimeout(viewportTimer);
  closeDemo();
  audio.dispose();
  stopTipTimer();
  document.removeEventListener("visibilitychange", visibility);
  document.removeEventListener("fullscreenchange", fullscreenChanged);
  window.removeEventListener("orientationchange", syncViewport);
  window.visualViewport?.removeEventListener("resize", syncViewport);
  try {
    screen.orientation?.removeEventListener("change", syncViewport);
  } catch {
    /* Optional browser API. */
  }
  document.body.classList.remove("battle-fullscreen");
  document.body.classList.remove("high-contrast", "font-small", "font-large");
  window.removeEventListener("keydown", keyboard);
});
</script>

<template>
  <div
    class="app-shell"
    :class="{ immersive: full && page === 'game', 'in-game': page === 'game' }"
  >
    <header class="topbar">
      <button class="brand" @click="page === 'game' ? pause() : home()">
        <span class="brand-mark"><img :src="pa('pea')" alt="" /></span
        ><span>庭院保卫战<small>PLANTS VS. ZOMBIES</small></span>
      </button>
      <nav>
        <button
          :class="{ active: page === 'home' && !modal }"
          @click="page === 'game' ? pause() : home()"
        >
          冒险之旅</button
        ><button
          @click="
            modal = 'map';
            world = level.world;
            if (engine) engine.paused = true;
          "
        >
          关卡地图</button
        ><button
          @click="
            modal = 'almanac';
            if (engine) engine.paused = true;
          "
        >
          庭院图鉴
        </button>
      </nav>
      <div class="top-tools">
        <span class="save-dot" :class="{ online: auth.loggedIn }"></span
        ><span class="saved">{{
          auth.loggedIn ? userName + " · " + cloudLabel : "本地存档"
        }}</span
        ><button
          class="icon-button"
          aria-label="设置"
          @click="
            modal = 'settings';
            if (engine) engine.paused = true;
          "
        >
          <img class="gear-icon" :src="uiIcon('settings')" alt="" />
        </button>
      </div>
    </header>
    <div v-if="save.warning" class="save-warning" role="status">
      <span>{{ save.warning }}</span
      ><button aria-label="关闭提示" @click="save.warning = ''">×</button>
    </div>
    <main>
      <template v-if="page === 'home'">
        <div class="eyebrow">
          <span></span> 慢一点，让阳光长成勇气 <span></span>
        </div>
        <section class="home-heading">
          <div>
            <p class="kicker">WELCOME TO YOUR BACKYARD</p>
            <h1>今天，也要守护好庭院。</h1>
            <p class="lede">种下一点阳光，准备迎接一群不请自来的邻居。</p>
          </div>
          <div class="chapter-note">
            <span>冒险进度</span
            ><strong
              >{{ save.data.completed.length }}<small> / 50</small></strong
            >
            <div class="mini-progress">
              <i :style="{ width: save.data.completed.length * 2 + '%' }"></i>
            </div>
          </div>
        </section>
        <section
          class="hero"
          :style="{ backgroundImage: `url('${gardenImage('day')}')` }"
        >
          <div class="hero-shade"></div>
          <div class="hero-copy">
            <span class="paper-label">第一站 · 阳光草坪</span>
            <h2>小小植物，<br />大大的守护。</h2>
            <p>
              阳光、豌豆，还有一点点策略。<br />你的庭院冒险，从这一刻开始。
            </p>
            <button
              class="primary start"
              @click="chooseLevel(Math.min(50, save.data.unlocked))"
            >
              {{ save.data.completed.length ? "继续冒险" : "开始冒险" }}
              <span>→</span>
            </button>
            <div class="hero-meta">
              <span>单人冒险</span><b>·</b><span>50 个关卡</span><b>·</b
              ><span>随时暂停</span>
            </div>
          </div>
          <img
            class="hero-plant hero-sun"
            :src="pa('sunflower')"
            alt="卡通向日葵"
          /><img
            class="hero-plant hero-pea"
            :src="pa('pea')"
            alt="卡通豌豆射手"
          /><img
            class="hero-plant hero-nut"
            :src="pa('wallnut')"
            alt="卡通坚果"
          /><img class="hero-zombie" :src="za('cone')" alt="路障僵尸" />
          <div class="hero-caption"><i></i> 自家草坪，谢绝僵尸。</div>
        </section>
        <section class="home-bottom">
          <button class="feature-card" @click="modal = 'map'">
            <span class="feature-art map-art">⌁</span
            ><span
              ><small>THE ADVENTURE</small><strong>一场穿越日夜的冒险</strong>
              <p>从阳光草坪，到月色下的红瓦屋顶。</p></span
            ><b>↗</b></button
          ><button class="feature-card" @click="modal = 'almanac'">
            <span class="feature-art"><img :src="pa('puff')" alt="" /></span
            ><span
              ><small>MEET THE NEIGHBORS</small
              ><strong>认识你的庭院伙伴</strong>
              <p>每一种植物，都有自己的拿手好戏。</p></span
            ><b>↗</b>
          </button>
          <button class="feature-card" @click="startDaily">
            <span class="feature-art map-art">✦</span
            ><span
              ><small>DAILY CHALLENGE</small><strong>每日挑战</strong>
              <p>
                {{
                  save.data.daily.date === daily.date
                    ? `今日已完成 · 最佳 ${Math.floor(save.data.daily.best / 60)}:${String(save.data.daily.best % 60).padStart(2, "0")}`
                    : daily.mods.length
                      ? "今日变体：" + daily.mods.map((m) => m.name).join(" · ")
                      : "今日未挑战 · 随机关卡与卡池"
                }}
              </p></span
            ><b>↗</b>
          </button>
          <div class="garden-tip" @click="nextTip">
            <span>园丁小贴士</span>
            <p>{{ gardenTips[tipIndex].text }}</p>
            <img
              :src="pa(gardenTips[tipIndex].img)"
              :alt="plantById[gardenTips[tipIndex].img].name"
            />
          </div>
        </section>
      </template>
      <template v-else-if="page === 'select'">
        <section class="section-title">
          <div class="title-line">
            <h1>选好伙伴，准备出发。</h1>
            <p class="lede">
              {{ worlds[level.world].name }} · 第 {{ level.label }} 关 ·
              {{
                level.mode === "normal"
                  ? "收集阳光，守住每一条路线"
                  : "本关采用特殊玩法，开局会显示操作提示"
              }}
            </p>
          </div>
          <button class="plain" @click="home">返回庭院</button>
        </section>
        <section class="difficulty-panel">
          <div class="difficulty-summary">
            <strong class="difficulty-label">挑战设置</strong>
            <p class="difficulty-meta">
              预计 {{ Math.round(previewSettings.duration / 60) }} 分钟 ·
              {{ modeNames[save.data.options.difficulty] }} · 分阶段围攻
            </p>
            <select
              aria-label="难度"
              v-model="save.data.options.difficulty"
              @change="save.persist()"
            >
              <option value="casual">休闲</option>
              <option value="standard">标准</option>
              <option value="hard">困难</option>
              <option value="custom">自定义</option></select
            ><button class="plain" @click="resetDifficulty">恢复默认</button>
          </div>
          <p
            v-if="save.data.options.difficulty === 'hard'"
            class="hint hard-mode-hint"
          >
            困难模式下僵尸会集火最薄弱且没有割草机的一行，优先拆除高威胁植物，还会绕开高坚果、把玩偶匣送到植物最密集处。
          </p>
          <div
            v-if="save.data.options.difficulty === 'custom'"
            class="custom-difficulty"
          >
            <label
              >目标时长：{{ save.data.options.minutes }} 分钟<input
                aria-label="目标时长"
                type="range"
                min="5"
                max="30"
                step="1"
                v-model.number="save.data.options.minutes"
                @change="save.persist()"
            /></label>
            <label
              >出怪数量：{{
                Math.round(save.data.options.density * 100)
              }}%<input
                aria-label="出怪数量"
                type="range"
                min=".5"
                max="2"
                step=".05"
                v-model.number="save.data.options.density"
                @change="save.persist()"
            /></label>
            <label
              >僵尸生命：{{ Math.round(save.data.options.health * 100) }}%<input
                aria-label="僵尸生命"
                type="range"
                min=".5"
                max="2"
                step=".05"
                v-model.number="save.data.options.health"
                @change="save.persist()"
            /></label>
            <label
              >移动速度：{{ Math.round(save.data.options.speed * 100) }}%<input
                aria-label="移动速度"
                type="range"
                min=".75"
                max="1.5"
                step=".05"
                v-model.number="save.data.options.speed"
                @change="save.persist()"
            /></label>
            <label
              >初始阳光：{{ save.data.options.sun
              }}<input
                aria-label="初始阳光"
                type="range"
                min="0"
                max="500"
                step="25"
                v-model.number="save.data.options.sun"
                @change="save.persist()"
            /></label>
            <label
              >准备时间：{{ save.data.options.prep }} 秒<input
                aria-label="准备时间"
                type="range"
                min="10"
                max="60"
                step="1"
                v-model.number="save.data.options.prep"
                @change="save.persist()"
            /></label>
            <label class="check-label"
              ><input
                type="checkbox"
                v-model="save.data.options.mowers"
                @change="save.persist()"
              />保留割草机</label
            >
            <p>
              自定义成绩单独记录，不解锁后续冒险关卡。最后一波结束后仍需清理剩余僵尸。
            </p>
          </div>
        </section>
        <section class="shop-panel">
          <div class="shop-bar">
            <div class="shop-lede">
              <strong>庭院商店</strong>
              <div
                class="shop-wallet"
                :class="{ 'can-buy': shopAffordable }"
                aria-live="polite"
              >
                <img :src="coinArt" alt="" /><b>{{ save.data.coins }}</b
                ><small>金币</small>
              </div>
            </div>
            <div class="shop-chips">
              <button
                v-for="item in shopItems"
                :key="item.id"
                class="shop-chip"
                :class="{
                  owned: !!save.data.items[item.id],
                  bought: boughtPulse === item.id,
                  short: save.data.coins < item.price,
                }"
                :disabled="save.data.coins < item.price"
                :title="item.name + '：' + item.desc"
                @click="buy(item)"
              >
                <span class="chip-thumb">
                  <img
                    v-if="item.img !== 'mower'"
                    :src="pa(item.img)"
                    :alt="item.name"
                  />
                  <span v-else class="mower-mini" aria-hidden="true"></span>
                </span>
                <span class="chip-copy">
                  <strong
                    >{{ item.name
                    }}<em v-if="save.data.items[item.id]"
                      >×{{ save.data.items[item.id] }}</em
                    ></strong
                  >
                  <span class="chip-price"
                    ><img :src="coinArt" alt="" />{{ item.price }}</span
                  >
                </span>
                <span v-if="save.data.coins < item.price" class="chip-lack"
                  >还差 {{ item.price - save.data.coins }}</span
                >
              </button>

              <button
                class="shop-chip seed"
                :class="{
                  full: seedSlotsFull,
                  bought: boughtPulse === 'seed-slot',
                  short: !seedSlotsFull && save.data.coins < seedSlotPrice,
                }"
                :disabled="!seedSlotsFull && save.data.coins < seedSlotPrice"
                :title="
                  '种子袋扩容：永久增加 1 个卡槽，从 ' +
                  BASE_SEED_SLOTS +
                  ' 扩到 ' +
                  MAX_SEED_SLOTS +
                  '。当前 ' +
                  slots +
                  '/' +
                  MAX_SEED_SLOTS +
                  '。'
                "
                @click="buySeedSlot"
              >
                <span class="chip-thumb">
                  <span class="slot-pips" aria-hidden="true">
                    <i
                      v-for="i in MAX_SEED_SLOTS"
                      :key="i"
                      :class="{ on: i <= slots }"
                    ></i>
                  </span>
                </span>
                <span class="chip-copy">
                  <strong>种子袋 {{ slots }}/{{ MAX_SEED_SLOTS }}</strong>
                  <span v-if="seedSlotsFull" class="chip-price full"
                    >★ 已满级</span
                  >
                  <span v-else class="chip-price"
                    ><img :src="coinArt" alt="" />{{ seedSlotPrice }}</span
                  >
                </span>
                <span
                  v-if="!seedSlotsFull && save.data.coins < seedSlotPrice"
                  class="chip-lack"
                  >还差 {{ seedSlotPrice - save.data.coins }}</span
                >
              </button>
            </div>
          </div>
        </section>
        <div class="selection-layout">
          <div class="selection-panel">
            <div class="panel-heading">
              <h3>你的种子袋</h3>
              <span>{{ chosen.length }} / {{ slots }} 个卡槽</span>
            </div>
            <div class="chosen-slots">
              <button
                v-for="i in slots"
                :key="i"
                @click="chosen[i - 1] && toggle(chosen[i - 1])"
              >
                <img
                  v-if="chosen[i - 1]"
                  :src="pa(chosen[i - 1])"
                  :alt="plantById[chosen[i - 1]].name"
                /><span v-else>＋</span>
              </button>
            </div>
            <div class="seed-grid">
              <button
                v-for="p in available"
                :key="p.id"
                class="seed-card"
                :class="{ picked: chosen.includes(p.id), denied: denied === p.id }"
                @click="toggle(p.id)"
                :title="p.desc"
              >
                <img :src="pa(p.id)" :alt="p.name" /><strong>{{
                  p.name
                }}</strong
                ><span class="price"><i></i>{{ p.cost }}</span
                ><i v-if="recommended.has(p.id)" class="badge">推荐</i
                ><i v-else-if="lowSun.has(p.id)" class="badge warn">夜间低效</i
                ><b v-if="chosen.includes(p.id)">✓</b>
              </button>
            </div>
            <label v-if="chosen.includes('imitater')"
              >模仿植物
              <select v-model="imitate">
                <option
                  v-for="p in plants.filter(
                    (p) => !p.upgrade && p.id !== 'imitater',
                  )"
                  :value="p.id"
                >
                  {{ p.name }}
                </option>
              </select></label
            >
          </div>
          <aside class="preview-panel">
            <div
              class="scene-preview"
              :style="{ backgroundImage: `url('${garden}')` }"
            >
              <span>{{ worlds[level.world].name }}</span>
            </div>
            <h3>本关的访客</h3>
            <div class="enemy-preview">
              <div v-for="id in level.enemies" :key="id">
                <img
                  :src="za(id)"
                  :alt="zombies.find((z) => z.id === id)?.name"
                /><span>{{ zombies.find((z) => z.id === id)?.name }}</span>
              </div>
            </div>
            <div v-if="seedNeeds.length" class="seed-needs" aria-label="本关准备">
              <span v-for="need in seedNeeds" :key="need.label" :class="{ ready: need.ready }">
                {{ need.ready ? '✓' : '○' }} {{ need.label }}<small>{{ need.ready ? '已带' : '未带' }}</small>
              </span>
            </div>
            <p class="hint">
              {{ levelHint }}
            </p>
            <button class="primary" :disabled="!chosen.length" @click="start">
              一起守住庭院 <span>→</span>
            </button>
          </aside>
        </div>
      </template>
      <template v-else>
        <section class="game-heading">
          <div>
            <span class="kicker">{{ worlds[battleLevel.world].name }}</span>
            <h2>
              {{ dailyMode ? "每日挑战" : `第 ${level.label} 关` }}
              <small>{{
                dailyMode
                  ? "种子 " + daily.date + (dailySalt ? " · 换一局" : "")
                  : level.mode === "normal"
                    ? "庭院防线"
                    : battleLevel.mode === "boss"
                      ? "最后的守护"
                      : "特别挑战"
              }}</small>
            </h2>
            <p v-if="dailyMode && daily.mods.length" class="daily-mods">
              <span v-for="mod in daily.mods" :key="mod.id" :title="mod.desc">{{
                mod.name
              }}</span>
            </p>
          </div>
          <div class="game-controls">
            <button class="plain" @click="sound">
              <img
                class="ctl-icon"
                :src="uiIcon(save.data.sound ? 'sound-on' : 'sound-off')"
                alt=""
              />音效：{{ save.data.sound ? "开" : "关" }}</button
            ><button class="plain" @click="speed">
              <span class="ctl-ico ctl-speed" aria-hidden="true"
                ><i></i><i></i></span
              >速度：{{ engine?.timeScale === 2 ? "2x" : "1x" }}</button
            ><button class="plain" @click="fullscreen">
              <img
                class="ctl-icon"
                :src="uiIcon('exit-fullscreen')"
                alt=""
              />全屏</button
            ><button v-if="dailyMode" class="plain" @click="rerollDaily">
              <img class="ctl-icon" :src="uiIcon('restart')" alt="" />换一局</button
            ><button class="plain" @click="pause">
              <img
                v-if="stats.paused"
                class="ctl-icon"
                :src="uiIcon('resume')"
                alt=""
              /><span v-else class="ctl-ico ctl-pause" aria-hidden="true"
                ><i></i><i></i></span
              >{{ stats.paused ? "继续游戏" : "暂停游戏" }}
            </button>
          </div>
        </section>
        <div class="game-frame">
          <div
            v-if="guideAnchor && !stats.paused && !result"
            class="guide-bubble"
            :class="'anchor-' + guideAnchor"
          >
            {{ engine?.message }}
          </div>
          <button
            v-if="full"
            class="battle-menu-button"
            aria-label="战斗菜单"
            @click="pause"
          >
            <img class="menu-icon" :src="uiIcon('menu')" alt="" />
          </button>
          <div class="seed-tray">
            <div class="sun-counter">
              <span class="sun-icon"></span
              ><strong :key="'sun-' + stats.sun" class="resource-count">{{ engine?.isBelt ? "传送带" : stats.sun }}</strong
              ><small>{{ engine?.isBelt ? "免费种植" : "阳光储备" }}</small>
            </div>
            <div v-if="!dailyMode" class="sun-counter coin-counter" title="本局收集的金币">
              <span class="coin-icon"></span
              ><strong :key="'coins-' + stats.coins" class="resource-count">{{ stats.coins }}</strong
              ><small>金币</small>
            </div>
            <div v-if="engine?.level.mode !== 'whack'" class="battle-seeds">
              <button
                v-for="(id, i) in engine?.isBelt ? stats.belt : battleCards"
                :key="id + '-' + i"
                class="battle-seed"
                :class="{
                  selected: stats.selected === id,
                  denied: denied === id,
                  unavailable:
                    !engine?.isBelt &&
                    (stats.sun < engine!.getDef(id).cost ||
                      stats.cooldowns[id] > 0),
                }"
                @pointerdown="seedDown(id)"
                @click="seedClick(id)"
                @dragstart.prevent
                :aria-label="'选择' + seedName(id)"
                :aria-pressed="stats.selected === id"
              >
                <span class="key">{{ (i + 1) % 10 }}</span
                ><img draggable="false" :src="seedPortrait(id)" :alt="seedName(id)" /><span>{{
                  seedName(id)
                }}</span
                ><strong>{{
                  engine?.isBelt ? "免费" : engine!.getDef(id).cost
                }}</strong>
                <div
                  v-if="stats.cooldowns[id] > 0 && !engine?.isBelt"
                  class="cooldown"
                  :style="{
                    height:
                      (stats.cooldowns[id] / engine!.getDef(id).cooldown) *
                        100 +
                      '%',
                  }"
                ></div>
              </button>
            </div>
            <div v-else class="hammer-tray" aria-label="选择锤子">
              <button :aria-pressed="stats.hammer === 'ice' && stats.selected !== 'tool'" @click="chooseHammer('ice')">冰锤 <small>Q · 冻结</small></button>
              <button :aria-pressed="stats.hammer === 'electric' && stats.selected !== 'tool'" @click="chooseHammer('electric')">电锤 <small>E · 爆发</small></button>
            </div>
            <button
              v-if="!['whack', 'bowling'].includes(engine?.level.mode || '')"
              class="shovel"
              :class="{ selected: stats.selected === 'shovel' }"
              @click="selectSeed('shovel')"
            >
              <img class="shovel-icon" :src="uiIcon('shovel')" alt="" />
              <span>铲子</span>
            </button>
            <button v-if="engine?.toolsUnlocked" class="garden-tool" :class="{ selected: stats.selected === 'tool' }"
              :aria-pressed="stats.selected === 'tool'" :disabled="stats.toolUses === 0 || stats.paused"
              :title="stats.toolHint" @click="useGardenTool">
              <img class="tool-icon" :src="uiIcon('transplant')" alt="" />
              <span>{{ stats.selected === 'tool' ? '取消' : engine.toolName }}</span><strong>{{ stats.toolUses }} / 3</strong><small>T · 工具</small>
            </button>
          </div>
          <div class="canvas-wrap">
            <div v-if="stats.fogSeconds > 0" class="fog-clear-badge">清雾 {{ stats.fogSeconds }} 秒</div>
            <div v-if="stats.weather" class="weather-badge" :class="{ warm: stats.weather === '阳光雨' }">
              <span>{{ stats.weather }}</span><small>{{ stats.weatherSeconds }} 秒 · {{ stats.weather === '寒风' ? '全场减速' : '阳光加速' }}</small>
            </div>
            <div ref="gameEl" class="phaser-mount" aria-label="游戏草坪"></div>
            <div v-if="booting && !result" class="game-overlay">
              <div class="pause-card boot-card">
                <span class="boot-spinner" aria-hidden="true"></span>
                <h2>正在布置庭院…</h2>
                <p>首次进入需要加载游戏资源，请稍候。</p>
              </div>
            </div>
            <div v-else-if="bootError" class="game-overlay">
              <div class="pause-card">
                <span class="kicker">LOAD FAILED</span>
                <h2>庭院没能搭起来。</h2>
                <p>{{ bootError }}</p>
                <button class="primary" @click="start">重新加载 →</button
                ><button class="text-button" @click="home">返回庭院</button>
              </div>
            </div>
            <div
              v-if="stats.message && !stats.paused && !result"
              class="game-message"
              :class="{ alert: stats.alert }"
            >
              {{ stats.message }}
            </div>
            <div v-if="lessonOpen && lesson && !result" class="game-overlay lesson-overlay">
              <div class="pause-card lesson-card">
                <span class="kicker">庭院新发现</span><h2>{{ lesson.title }}</h2>
                <p>{{ lesson.text }}</p>
                <button class="primary" @click="closeLesson">开始体验</button>
                <button class="text-button" @click="closeLesson">跳过提示</button>
              </div>
            </div>
            <div v-if="stats.paused && !lessonOpen && !modal && !result" class="game-overlay">
              <div class="pause-card">
                <span class="kicker">TAKE A LITTLE BREAK</span>
                <h2>庭院，等你回来。</h2>
                <p>植物和僵尸都暂停了，放心休息一下。</p>
                <button v-if="full" class="plain" @click="sound">
                  <img
                    class="btn-icon"
                    :src="uiIcon(save.data.sound ? 'sound-on' : 'sound-off')"
                    alt=""
                  />
                  <span class="btn-label">{{
                    save.data.sound ? "关闭声音" : "打开声音"
                  }}</span>
                </button>
                <button v-if="full" class="plain" @click="exitBattleFullscreen">
                  <img
                    class="btn-icon"
                    :src="uiIcon('exit-fullscreen')"
                    alt=""
                  />
                  <span class="btn-label">退出全屏</span>
                </button>
                <button class="primary" @click="pause">
                  <img class="btn-icon" :src="uiIcon('resume')" alt="" />
                  <span class="btn-label">继续守护</span>
                  <span class="btn-arrow" aria-hidden="true">→</span>
                </button>
                <button class="plain" @click="start">
                  <img class="btn-icon" :src="uiIcon('restart')" alt="" />
                  <span class="btn-label">重新开始本关</span>
                </button>
                <button class="text-button" @click="home">
                  <img class="btn-icon" :src="uiIcon('home')" alt="" />
                  <span class="btn-label">返回主菜单</span>
                </button>
              </div>
            </div>
            <div v-if="result" class="game-overlay">
              <div class="pause-card">
                <img
                  :src="result === 'won' ? pa('sunflower') : za('basic')"
                  alt=""
                /><span class="kicker">{{
                  result === "won" ? "A LITTLE VICTORY" : "TRY ANOTHER STRATEGY"
                }}</span>
                <h2>
                  {{
                    result === "won"
                      ? "又守住了美好的一天。"
                      : "僵尸闯进了庭院。"
                  }}
                </h2>
                <p>
                  {{
                    result === "won"
                      ? dailyMode
                        ? dailyOfficial
                          ? "今日挑战完成，最佳成绩已记录。"
                          : "换一局挑战完成，不计入官方最佳。"
                        : engine?.settings.difficulty === "custom"
                          ? "自定义挑战成绩已保存，不影响冒险解锁。"
                          : "通关进度已保存，下一段冒险在等你。"
                      : loseTip
                  }}
                </p>
                <p v-if="dailyMode && daily.mods.length" class="daily-mods">
                  今日条件：{{ daily.mods.map((m) => m.name).join("、") }}
                </p>
                <p v-if="result === 'won' && resultStars" class="result-stars">
                  {{ "★".repeat(resultStars) }}{{ "☆".repeat(3 - resultStars) }}
                </p>
                <div class="result-stats">
                  <span
                    >用时 {{ Math.floor((engine?.time || 0) / 60) }}:{{
                      String(Math.floor((engine?.time || 0) % 60)).padStart(
                        2,
                        "0",
                      )
                    }}</span
                  ><span>击杀 {{ engine?.kills || 0 }}</span
                  ><span>剩余阳光 {{ engine?.sun || 0 }}</span
                  ><span v-if="engine?.settings.mowers"
                    >失去小推车
                    {{ engine.mowersLost }}</span
                  >
                </div>
                <p
                  v-for="name in newAchievements"
                  :key="name"
                  class="achievement-earned"
                >
                  解锁成就：{{ name }}
                </p>
                <div v-if="result === 'lost' && !dailyMode" class="difficulty-switch">
                  <span
                    >{{
                      (save.data.lossStreak[levelId] ?? 0) >= 2
                        ? "这关有点难？换个难度："
                        : "换个难度："
                    }}</span
                  ><button
                    v-for="d in ['casual', 'standard', 'hard'] as const"
                    :key="d"
                    class="plain"
                    :class="{
                      active: engine?.settings.difficulty === d,
                      recommend:
                        (save.data.lossStreak[levelId] ?? 0) >= 2 &&
                        d === 'casual' &&
                        engine?.settings.difficulty !== 'casual',
                    }"
                    @click="switchDifficulty(d)"
                  >
                    {{ modeNames[d] }}
                  </button>
                </div>
                <p v-if="engine?.coins && !dailyMode" class="coin-earned">
                  本局收集金币 +{{ engine.coins }}
                </p>
                <button
                  class="primary"
                  @click="
                    result === 'won' &&
                    !dailyMode &&
                    levelId < 50 &&
                    engine?.settings.difficulty !== 'custom'
                      ? chooseLevel(levelId + 1)
                      : start()
                  "
                >
                  {{
                    result === "won" &&
                    !dailyMode &&
                    levelId < 50 &&
                    engine?.settings.difficulty !== "custom"
                      ? "前往下一关 →"
                      : "重新挑战 →"
                  }}</button
                ><button v-if="dailyMode" class="text-button" @click="rerollDaily">
                  换一局</button
                ><button class="text-button" @click="home">返回庭院</button>
              </div>
            </div>
          </div>
          <div class="game-status">
            <span v-if="stats.paused"
              ><i class="status-dot"></i>休息一下</span
            >
            <div class="wave-track">
              <span>{{ battleLevel.mode === "boss" ? "僵王生命" : "僵尸进攻" }}</span>
              <div>
                <i
                  :style="{
                    width:
                      (battleLevel.mode === 'boss'
                        ? (stats.boss / (engine?.bossMax || 24000)) * 100
                        : stats.progress) + '%',
                  }"
                ></i
                ><b
                  v-for="(f, i) in flagMarks"
                  :key="i"
                  class="flag-mark"
                  :style="{ left: f + '%' }"
                ></b>
              </div>
              <b>{{
                battleLevel.mode === "boss"
                  ? Math.max(0, Math.ceil(stats.boss))
                  : Math.round(stats.progress) + "%"
              }}</b>
            </div>
            <span
              >{{ Math.floor(stats.time / 60) }}:{{
                String(stats.time % 60).padStart(2, "0")
              }}</span
            >
          </div>
        </div>
        <div class="wave-details" v-if="engine?.schedule.length">
          <span>第 {{ stats.wave }} / {{ stats.totalWaves }} 波</span
          ><span>{{
            stats.wave < stats.totalWaves
              ? "下一波：" + stats.nextWave + " 秒"
              : "最终围攻：清理剩余僵尸"
          }}</span
          ><span
            >{{ modeNames[engine.settings.difficulty] }} · 目标
            {{ Math.round(engine.settings.duration / 60) }} 分钟</span
          >
        </div>
        <p class="keyboard-hint">
          点击种子，再点击草坪种植 · 按住 Shift 连种 · 点击阳光收集 ·
          空格暂停 · F 键全屏 · 数字键选卡 · 方向键移动光标 · 回车种植 · S 键切换铲子 · 连按两次 R 重开本关
        </p>
      </template>
    </main>
    <div v-if="portraitGate" class="rotate-gate">
      <div class="rotate-card">
        <div class="rotate-phone" aria-hidden="true"><i></i></div>
        <h2>请把手机横过来</h2>
        <p>庭院是宽屏战场，横屏后能同时看清整条草坪和右侧的僵尸。</p>
        <button class="primary" @click="tryRotate">尝试全屏 / 旋转</button>
        <button class="text-button" @click="allowPortraitPlay = true">
          竖屏也要玩
        </button>
      </div>
    </div>
    <div v-if="installTip" class="install-tip">
      <span
        >想要无地址栏的真全屏：iPhone 请点 Safari「分享」→「添加到主屏幕」，
        从桌面图标进入即可。</span
      ><button aria-label="知道了" @click="installTip = false">×</button>
    </div>
    <footer>
      <span>一方小院，一场大冒险。</span
      ><span>Vue 3 <i>·</i> Phaser 3 <i>·</i> 本地保存</span>
    </footer>
    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <section
        class="modal"
        :class="{ 'wide-modal': modal !== 'settings' }"
        role="dialog"
        aria-modal="true"
      >
        <button class="close" aria-label="关闭" @click="modal = ''">×</button>
        <template v-if="modal === 'map'"
          ><p class="kicker">THE ADVENTURE MAP</p>
          <h2>每一片庭院，都有新故事。</h2>
          <div class="world-tabs">
            <button
              v-for="(w, i) in worlds"
              :class="{ active: world === i }"
              @click="world = i"
            >
              <span :style="{ background: w.color }"></span>{{ w.name }}
            </button>
          </div>
          <div
            class="map-banner"
            :style="{
              backgroundImage: `url('${gardenImage(worlds[world].scene)}')`,
            }"
          >
            <h3>{{ worlds[world].name }}</h3>
            <p>{{ worlds[world].subtitle }}</p>
          </div>
          <div class="level-grid">
            <button
              v-for="l in levels.filter((l) => l.world === world)"
              :disabled="l.id > save.data.unlocked"
              :class="{
                complete: save.data.completed.includes(l.id),
                current: l.id === save.data.unlocked,
              }"
              @click="chooseLevel(l.id)"
            >
              <span>{{
                save.data.completed.includes(l.id)
                  ? "✓"
                  : l.id > save.data.unlocked
                    ? "·"
                    : "→"
              }}</span
              ><strong>{{ l.label }}</strong
              ><span v-if="save.data.stars[l.id]" class="level-stars">{{
                "★".repeat(save.data.stars[l.id])
              }}</span
              ><small v-if="bestTimes[l.id] !== undefined" class="level-best"
                >最佳 {{ mmss(bestTimes[l.id]) }}</small
              ><small>{{
                l.id > save.data.unlocked
                  ? "尚未解锁"
                  : l.mode === "normal"
                    ? "庭院防守"
                    : "特别挑战"
              }}</small>
            </button>
          </div>
          <p class="hint">
            按顺序通关，解锁新的植物和庭院。已完成的关卡可以随时重玩。
          </p></template
        >
        <template v-if="modal === 'almanac'"
          ><p class="kicker">THE GARDEN ALMANAC</p>
          <h2>知己知彼，庭院常青。</h2>
          <div class="world-tabs">
            <button
              :class="{ active: tab === 'plants' }"
              @click="tab = 'plants'"
            >
              植物伙伴 · {{ plants.length }}</button
            ><button
              :class="{ active: tab === 'zombies' }"
              @click="tab = 'zombies'"
            >
              僵尸访客 · {{ zombies.length }}</button
            ><button
              :class="{ active: tab === 'achievements' }"
              @click="tab = 'achievements'"
            >
              成就 · {{ save.data.achievements.length }} /
              {{ achievementDefs.length }}
            </button>
          </div>
          <details v-if="tab !== 'achievements'" class="combat-guide">
            <summary>战斗手册 · 冰火、冰电与护甲</summary>
            <div v-for="rule in combatGuide" :key="rule.title"><h3>{{ rule.title }}</h3><p>{{ rule.text }}</p></div>
          </details>
          <div v-if="tab === 'achievements'" class="almanac-grid">
            <article
              v-for="a in achievementDefs"
              :key="a.id"
              :class="{ locked: !save.data.achievements.includes(a.id) }"
            >
              <span class="achievement-mark">{{
                save.data.achievements.includes(a.id) ? "★" : "☆"
              }}</span>
              <div>
                <h3>{{ a.name }}</h3>
                <p>{{ a.desc }}</p>
              </div>
            </article>
          </div>
          <div v-else class="almanac-grid">
            <article
              v-for="item in tab === 'plants' ? plants : zombies"
              :key="item.id"
            >
              <img
                :src="tab === 'plants' ? pa(item.id) : za(item.id)"
                :alt="item.name"
              />
              <div>
                <small v-if="'cost' in item"
                  >{{ item.cost }} 阳光 · 生命 {{ item.hp }} ·
                  {{
                    item.unlock > save.data.unlocked ? "尚未解锁" : "已解锁"
                  }}</small
                ><small v-else
                  >生命 {{ item.hp }} · 护甲 {{ item.armor }} · 移速 {{ item.speed }}</small
                >
                <h3>{{ item.name }}</h3>
                <p>{{ item.desc }}</p>
                <p v-if="tip(item)" class="tip"><b>对策</b>{{ tip(item) }}</p>
                <p v-if="counterNames(item)" class="tip">
                  <b>克制</b>{{ counterNames(item) }}
                </p>
                <button
                  v-if="demoable(item)"
                  class="plain demo-btn"
                  @click="openDemo(item.id)"
                >
                  试玩
                </button>
              </div>
            </article>
          </div></template
        >
        <template v-if="modal === 'settings'"
          ><p class="kicker">MAKE YOURSELF AT HOME</p>
          <h2>庭院设置</h2>
          <div class="setting-row">
            <span>游戏音效<small>攻击、啃食、低吼、爆炸与场景反馈</small></span
            ><button class="plain" @click="sound">
              {{ save.data.sound ? "已开启" : "已关闭" }}
            </button>
          </div>
          <div class="setting-row">
            <span>音量</span
            ><input
              aria-label="音量"
              type="range"
              min="0"
              max="1"
              step=".05"
              v-model.number="save.data.volume"
              @input="updateSettings"
            /><button class="plain" @click="sampleSound">试听</button>
          </div>
          <div
            class="setting-row"
            v-for="(label, channel) in {
              battle: '战斗音效',
              music: '背景音乐',
              environment: '环境声音',
              ui: '界面提示',
            }"
            :key="channel"
          >
            <span>{{ label }}</span
            ><input
              type="range"
              min="0"
              max="1"
              step="0.05"
              :aria-label="label"
              v-model.number="save.data.mix[channel]"
              @input="updateSettings"
            /><button class="plain" @click="sampleChannel(channel)">
              试听
            </button>
          </div>
          <div class="setting-row">
            <span>特效质量</span
            ><select
              aria-label="特效质量"
              v-model="save.data.quality"
              @change="updateSettings"
            >
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </div>
          <div class="setting-row">
            <span>爆炸震动</span
            ><input
              aria-label="爆炸震动"
              type="checkbox"
              v-model="save.data.shake"
              @change="updateSettings"
            />
          </div>
          <div class="setting-row">
            <span
              >高对比度<small>加深边框与文字，减速僵尸用更深的蓝色</small></span
            ><button
              class="plain"
              @click="
                save.data.contrast = !save.data.contrast;
                save.persist();
              "
            >
              {{ save.data.contrast ? "已开启" : "已关闭" }}
            </button>
          </div>
          <div class="setting-row">
            <span>界面字号<small>不影响游戏画面本身</small></span
            ><select
              aria-label="界面字号"
              v-model="save.data.fontSize"
              @change="save.persist()"
            >
              <option value="small">小</option>
              <option value="standard">标准</option>
              <option value="large">大</option>
            </select>
          </div>
          <div class="setting-row">
            <span
              >用户账号<small v-if="!auth.loggedIn"
                >登录后可在不同设备同步进度</small
              ><small v-else>已登录：{{ userName }} · {{ cloudLabel }}</small></span
            ><button
              v-if="!auth.loggedIn"
              class="plain"
              @click="openAccount('login')"
            >
              登录 / 注册</button
            ><button v-else class="plain" @click="signOut">退出登录</button>
          </div>
          <div v-if="auth.loggedIn" class="setting-row">
            <span>云端同步<small>“上传本机”会覆盖云端，“下载云端”会覆盖本机</small></span
            ><span class="save-buttons"
              ><button class="plain" @click="uploadSave">上传本机</button
              ><button class="plain" @click="downloadSave">下载云端</button></span
            >
          </div>
          <div class="setting-row">
            <span
              >冒险存档<small
                >已完成 {{ save.data.completed.length }} / 50 关</small
              ></span
            ><span class="pill">{{
              auth.loggedIn ? "已接入账号" : "保存在本机"
            }}</span>
          </div>
          <p class="hint">
            进度保存在当前浏览器中。清除网站数据或更换设备前，请先导出备份。进行中的战局不会保存。
          </p>
          <div class="save-buttons">
            <button class="primary" @click="exportSave">导出存档</button
            ><button class="plain" @click="file?.click()">导入存档</button
            ><input
              ref="file"
              type="file"
              accept=".json,application/json"
              hidden
              @change="importSave"
            />
          </div>
          <p v-if="save.warning" role="status" class="notice">
            {{ save.warning }}
          </p></template
        >
        <template v-if="modal === 'account'"
          ><p class="kicker">YOUR GARDEN ACCOUNT</p>
          <h2>{{ authMode === "login" ? "回到你的庭院" : "新建一个庭院账号" }}</h2>
          <div class="world-tabs">
            <button
              :class="{ active: authMode === 'login' }"
              @click="
                authMode = 'login';
                auth.error = '';
              "
            >
              登录</button
            ><button
              :class="{ active: authMode === 'register' }"
              @click="
                authMode = 'register';
                auth.error = '';
              "
            >
              注册
            </button>
          </div>
          <form class="auth-form" @submit.prevent="submitAuth">
            <label
              ><span>用户名</span
              ><input
                v-model.trim="authName"
                :disabled="auth.busy"
                autocomplete="username"
                maxlength="20"
                placeholder="1-20 位，不含空格"
            /></label>
            <label
              ><span>密码</span
              ><input
                v-model="authPassword"
                type="password"
                :disabled="auth.busy"
                :autocomplete="
                  authMode === 'login' ? 'current-password' : 'new-password'
                "
                maxlength="128"
                placeholder="至少 4 位"
            /></label>
            <p v-if="auth.error" role="status" class="notice">
              {{ auth.error }}
            </p>
            <div class="save-buttons">
              <button
                class="primary"
                type="submit"
                :disabled="auth.busy || !authName || authPassword.length < 4"
              >
                {{
                  auth.busy
                    ? "请稍候…"
                    : authMode === "login"
                      ? "登录"
                      : "注册并登录"
                }}
              </button>
            </div>
          </form>
          <p class="hint">
            登录后进度保存到账号，可在不同设备继续游戏。退出登录不会删除本机存档。
          </p></template
        >
      </section>
    </div>
    <div v-if="demoId" class="demo-overlay" @click.self="closeDemo">
      <div class="demo-card">
        <p class="demo-title">
          试玩 · {{ plantById[demoId].name
          }}<small>自动迎击来敌，10 秒后返回图鉴</small>
        </p>
        <div ref="demoEl" class="demo-mount"></div>
        <button class="plain" @click="closeDemo">关闭</button>
      </div>
    </div>
  </div>
</template>
