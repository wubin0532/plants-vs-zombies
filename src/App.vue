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
  zombieById,
  worlds,
  levels,
  isMushroom,
  isNight,
  recommendCards,
  combatGuide,
} from "./game/content";
import type { PlantDef, ZombieDef } from "./game/content";
import { plantImage, zombieImage, gardenImage, bowlImage } from "./game/art";
import { battleSettings, defaultOptions } from "./game/difficulty";
import { dailyChallenge } from "./game/daily";
import { achievementDefs, checkAchievements } from "./achievements";
import { Engine } from "./game/engine";
import { mountGame } from "./game/scene";
import { GardenAudio } from "./game/audio";
import type { SoundKind } from "./game/audio";
import { seedSlotPriceFor, useSave } from "./store";
const save = useSave();
save.load();
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
  newAchievements = ref<string[]>([]),
  full = ref(false),
  file = ref<HTMLInputElement>(),
  imitate = ref("pea");
let game: Awaited<ReturnType<typeof mountGame>> | undefined;
let gameGeneration = 0, starting = false;
let lastRestartKey = -1e9;
const audio = new GardenAudio();
const lessonOpen = ref(false);
let settled = false;
const level = computed(() => levels[levelId.value - 1]);
const available = computed(() =>
  plants.filter((p) => p.unlock <= save.data.unlocked),
);
const slots = computed(() =>
  Math.min(
    10,
    6 + Math.floor((save.data.unlocked - 1) / 10) + save.data.seedSlots,
  ),
);
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
const daily = computed(() => dailyChallenge(new Date(), save.data.unlocked));
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
const seedSlotPrice = computed(() => seedSlotPriceFor(save.data.seedSlots));
const seedSlotsFull = computed(() => slots.value >= 10);
function buy(item: (typeof shopItems)[number]) {
  if (save.buyItem(item.id, item.price)) audio.play("sun");
}
function buySeedSlot() {
  if (seedSlotsFull.value || save.data.coins < seedSlotPrice.value) return;
  save.data.coins -= seedSlotPrice.value;
  save.data.seedSlots += 1;
  save.persist();
  audio.play("sun");
}
function startDaily() {
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
  engine.value = undefined;
  playing.value = false;
  result.value = "";
  resultStars.value = 0;
  newAchievements.value = [];
  dailyMode.value = false;
  levelId.value = id;
  modal.value = "";
  const unlocked = available.value.map((p) => p.id);
  chosen.value = recommendCards(level.value, unlocked, slots.value);
  page.value = "select";
  window.scrollTo(0, 0);
  audio.play("click");
}
function toggle(id: string) {
  if (chosen.value.includes(id))
    chosen.value = chosen.value.filter((x) => x !== id);
  else if (chosen.value.length < slots.value) chosen.value.push(id);
  audio.play("click");
}
async function start() {
  const d = dailyMode.value ? daily.value : null;
  if (starting || (!d && !chosen.value.length)) return;
  starting = true;
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
        d ? defaultOptions() : save.data.options,
      ),
    );
    engine.value.imitate = imitate.value;
    engine.value.toolsUnlocked ||= save.data.unlocked >= 6;
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
    await nextTick();
    if (generation !== gameGeneration || !gameEl.value) return;
    window.scrollTo(0, 0);
    const mounted = await mountGame(
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
            if (dailyMode.value) save.recordDaily(daily.value.date, e.time);
            else if (e.settings.difficulty !== "custom") {
              save.win(levelId.value, e.coins);
              resultStars.value =
                1 +
                (mowersIntact ? 1 : 0) +
                (e.time <= e.settings.duration ? 1 : 0);
              save.recordStars(levelId.value, resultStars.value);
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
    if (generation === gameGeneration) game = mounted;
    else mounted.destroy(true);
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
  engine.value = undefined;
  page.value = "home";
  playing.value = false;
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
    audio.play("click");
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
  if (document.fullscreenElement)
    await document.exitFullscreen().catch(() => {});
  try {
    screen.orientation?.unlock();
  } catch {
    /* Optional browser API. */
  }
}
async function fullscreen() {
  if (full.value) {
    await exitBattleFullscreen();
    return;
  }
  full.value = true;
  await nextTick();
  try {
    await document.documentElement.requestFullscreen?.();
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
  window.dispatchEvent(new Event("resize"));
}
function fullscreenChanged() {
  if (!document.fullscreenElement) full.value = false;
  window.dispatchEvent(new Event("resize"));
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
watch(modal, (value) => {
  if (!value) closeDemo();
});
function visibility() {
  if (document.hidden && engine.value?.status === "playing") {
    engine.value.paused = true;
    tick.value++;
  }
}
function keyboard(e: KeyboardEvent) {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement
  )
    return;
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
  if (e.key.toLowerCase() === "t") useGardenTool();
  if (e.key.toLowerCase() === "q") chooseHammer("ice");
  if (e.key.toLowerCase() === "e") chooseHammer("electric");
  if ((e.key === "r" || e.key === "R") && engine.value) {
    if (result.value || performance.now() - lastRestartKey < 3000) void start();
    else {
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
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("fullscreenchange", fullscreenChanged);
  window.addEventListener("keydown", keyboard);
});
onBeforeUnmount(() => {
  gameGeneration++;
  game?.destroy(true);
  closeDemo();
  audio.dispose();
  stopTipTimer();
  document.removeEventListener("visibilitychange", visibility);
  document.removeEventListener("fullscreenchange", fullscreenChanged);
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
        <span class="save-dot"></span><span class="saved">本地存档</span
        ><button
          class="icon-button"
          aria-label="设置"
          @click="
            modal = 'settings';
            if (engine) engine.paused = true;
          "
        >
          ⚙
        </button>
      </div>
    </header>
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
          <div>
            <p class="kicker">PREPARE YOUR GARDEN</p>
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
            <div>
              <h3>挑战设置</h3>
              <p>
                预计 {{ Math.round(previewSettings.duration / 60) }} 分钟 ·
                {{ modeNames[save.data.options.difficulty] }} · 分阶段围攻
              </p>
            </div>
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
          <div class="panel-heading">
            <h3>庭院商店</h3>
            <span>{{ save.data.coins }} 金币 · 消耗道具开局使用，扩容永久生效</span>
          </div>
          <div class="shop-grid">
            <div v-for="item in shopItems" :key="item.id" class="shop-item">
              <div class="shop-thumb">
                <img
                  v-if="item.img !== 'mower'"
                  :src="pa(item.img)"
                  :alt="item.name"
                />
                <span v-else class="mower-mini" aria-hidden="true"></span>
              </div>
              <strong
                >{{ item.name
                }}<em v-if="save.data.items[item.id]"
                  >已持有 ×{{ save.data.items[item.id] }}</em
                ></strong
              >
              <p>{{ item.desc }}</p>
              <button
                class="plain"
                :disabled="save.data.coins < item.price"
                @click="buy(item)"
              >
                {{ item.price }} 金币
              </button>
            </div>
            <div class="shop-item seed-slot">
              <div class="shop-thumb">
                <span class="slot-mini" aria-hidden="true">
                  <i></i><i></i><i></i>
                </span>
              </div>
              <strong
                >种子袋扩容<em v-if="save.data.seedSlots"
                  >已扩容 +{{ save.data.seedSlots }}</em
                ></strong
              >
              <p>永久增加 1 个卡槽。当前 {{ slots }} / 10。</p>
              <button
                class="plain"
                :disabled="save.data.coins < seedSlotPrice || seedSlotsFull"
                @click="buySeedSlot"
              >
                {{ seedSlotPrice }} 金币
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
                :class="{ picked: chosen.includes(p.id) }"
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
                  ? "种子 " + daily.date
                  : level.mode === "normal"
                    ? "庭院防线"
                    : battleLevel.mode === "boss"
                      ? "最后的守护"
                      : "特别挑战"
              }}</small>
            </h2>
          </div>
          <div class="game-controls">
            <button class="plain" @click="sound">
              {{ save.data.sound ? "音效：开" : "音效：关" }}</button
            ><button class="plain" @click="speed">
              速度：{{ engine?.timeScale === 2 ? "2x" : "1x" }}</button
            ><button class="plain" @click="fullscreen">全屏</button
            ><button class="plain" @click="pause">
              {{ stats.paused ? "继续游戏" : "暂停游戏" }}
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
            ☰
          </button>
          <div class="seed-tray">
            <div class="sun-counter">
              <span class="sun-icon"></span
              ><strong :key="'sun-' + stats.sun" class="resource-count">{{ engine?.isBelt ? "传送带" : stats.sun }}</strong
              ><small>{{ engine?.isBelt ? "免费种植" : "阳光储备" }}</small>
            </div>
            <div class="sun-counter coin-counter" title="本局收集的金币">
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
              <span class="shovel-icon" aria-hidden="true">♠</span
              ><span>铲子</span>
            </button>
            <button v-if="engine?.toolsUnlocked" class="garden-tool" :class="{ selected: stats.selected === 'tool' }"
              :aria-pressed="stats.selected === 'tool'" :disabled="stats.toolUses === 0 || stats.paused"
              :title="stats.toolHint" @click="useGardenTool">
              <span>{{ stats.selected === 'tool' ? '取消' : engine.toolName }}</span><strong>{{ stats.toolUses }} / 3</strong><small>T · 工具</small>
            </button>
          </div>
          <div v-if="engine?.toolsUnlocked" class="mechanic-strip">
            <span v-if="stats.fogSeconds > 0" class="fog-timer">清雾剩余 {{ stats.fogSeconds }} 秒</span>
            <span>{{ stats.selected === 'tool' ? stats.toolHint : engine?.level.mode === 'whack' ? '先冰后电 · Q / E 切锤' : '冰电爆发 ' + stats.reactions + ' 次 · T 使用工具' }}</span>
            <button v-if="lesson" @click="showLesson">玩法说明</button>
          </div>
          <div class="canvas-wrap">
            <div v-if="stats.fogSeconds > 0" class="fog-clear-badge">清雾 {{ stats.fogSeconds }} 秒</div>
            <div v-if="stats.weather" class="weather-badge" :class="{ warm: stats.weather === '阳光雨' }">
              <span>{{ stats.weather }}</span><small>{{ stats.weatherSeconds }} 秒 · {{ stats.weather === '寒风' ? '全场减速' : '阳光加速' }}</small>
            </div>
            <div ref="gameEl" class="phaser-mount" aria-label="游戏草坪"></div>
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
                  {{ save.data.sound ? "关闭声音" : "打开声音" }}
                </button>
                <button v-if="full" class="plain" @click="exitBattleFullscreen">
                  退出全屏
                </button>
                <button class="primary" @click="pause">继续守护 →</button
                ><button class="plain" @click="start">重新开始本关</button
                ><button class="text-button" @click="home">返回主菜单</button>
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
                        ? "今日挑战完成，明天再来。"
                        : engine?.settings.difficulty === "custom"
                          ? "自定义挑战成绩已保存，不影响冒险解锁。"
                          : "通关进度已保存，下一段冒险在等你。"
                      : loseTip
                  }}
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
                <div v-if="result === 'lost'" class="difficulty-switch">
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
                <p v-if="engine?.coins" class="coin-earned">
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
                ><button class="text-button" @click="home">返回庭院</button>
              </div>
            </div>
          </div>
          <div class="game-status">
            <span
              ><i class="status-dot"></i>
              {{ stats.paused ? "休息一下" : "庭院保卫中" }}</span
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
          空格暂停 · 数字键选卡 · S 键切换铲子 · 连按两次 R 重开本关
        </p>
      </template>
    </main>
    <footer>
      <span>一方小院，一场大冒险。</span
      ><span>Vue 3 <i>·</i> Phaser 3 <i>·</i> 本地保存</span>
    </footer>
    <div v-if="modal" class="modal-backdrop" @click.self="modal = ''">
      <section class="modal" :class="{ 'wide-modal': modal !== 'settings' }">
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
              >冒险存档<small
                >已完成 {{ save.data.completed.length }} / 50 关</small
              ></span
            ><span class="pill">保存在本机</span>
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
