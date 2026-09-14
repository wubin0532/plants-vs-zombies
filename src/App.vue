<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
  markRaw,
} from "vue";
import { plants, plantById, zombies, worlds, levels } from "./game/content";
import { plantImage, zombieImage, gardenImage } from "./game/art";
import { battleSettings, defaultOptions } from "./game/difficulty";
import { Engine } from "./game/engine";
import { mountGame } from "./game/scene";
import { GardenAudio } from "./game/audio";
import { useSave } from "./store";
const save = useSave();
save.load();
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
  full = ref(false),
  file = ref<HTMLInputElement>(),
  imitate = ref("pea");
let game: ReturnType<typeof mountGame> | undefined;
const audio = new GardenAudio();
let settled = false;
const level = computed(() => levels[levelId.value - 1]);
const available = computed(() =>
  plants.filter((p) => p.unlock <= save.data.unlocked),
);
const slots = computed(() =>
  Math.min(10, 6 + Math.floor((save.data.unlocked - 1) / 10)),
);
const garden = computed(() => gardenImage(level.value.scene));
const previewSettings = computed(() =>
  battleSettings(level.value, save.data.options),
);
const modeNames = {
  casual: "休闲",
  standard: "标准",
  hard: "困难",
  custom: "自定义",
};
function updateSettings() {
  audio.volume = save.data.volume;
  audio.mix = { ...save.data.mix };
  save.persist();
}
function sampleSound() {
  void audio.unlock().then(() => audio.play("groan"));
}
function resetDifficulty() {
  save.data.options = defaultOptions();
  save.persist();
}
const stats = computed(() => {
  void tick.value;
  const e = engine.value;
  return {
    sun: e?.sun || 0,
    selected: e?.selected || "",
    paused: e?.paused || false,
    progress: e ? Math.min(100, (e.spawned / e.level.count) * 100) : 0,
    message: e && e.time < e.messageUntil ? e.message : "",
    belt: e?.conveyor || [],
    cooldowns: { ...e?.cooldowns },
    time: Math.floor(e?.time || 0),
    boss: e?.bossHp || 0,
    wave: e?.wave || 0,
    totalWaves: e?.totalWaves || 0,
    nextWave: Math.ceil(e?.nextWaveIn || 0),
  };
});
const pa = plantImage,
  za = zombieImage;
function chooseLevel(id: number) {
  void exitBattleFullscreen();
  audio.stop();
  game?.destroy(true);
  game = undefined;
  engine.value = undefined;
  playing.value = false;
  result.value = "";
  levelId.value = id;
  modal.value = "";
  const unlocked = available.value.map((p) => p.id);
  const candidates =
    level.value.world === 0
      ? [
          "sunflower",
          "pea",
          "wallnut",
          "potato",
          "snowpea",
          "cherry",
          "repeater",
          "chomper",
        ]
      : level.value.world === 1
        ? [
            "sunshroom",
            "puff",
            "fume",
            "grave",
            "wallnut",
            "ice",
            "hypno",
            "doom",
          ]
        : level.value.world === 2
          ? [
              "sunflower",
              "lily",
              "pea",
              "wallnut",
              "kelp",
              "squash",
              "three",
              "cherry",
            ]
          : level.value.world === 3
            ? [
                "sunshroom",
                "lily",
                "fume",
                "lantern",
                "cactus",
                "blover",
                "wallnut",
                "kelp",
                "star",
              ]
            : [
                "sunflower",
                "pot",
                "cabbage",
                "kernel",
                "wallnut",
                "cherry",
                "umbrella",
                "melon",
                "jalapeno",
              ];
  chosen.value = candidates
    .filter((id) => unlocked.includes(id))
    .slice(0, slots.value);
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
  if (!chosen.value.length) return;
  audio.stop();
  await audio.unlock();
  save.persist();
  game?.destroy(true);
  engine.value = markRaw(
    new Engine(
      levelId.value,
      [...chosen.value],
      levelId.value * 719,
      save.data.options,
    ),
  );
  engine.value.imitate = imitate.value;

  settled = false;
  result.value = "";
  page.value = "game";
  playing.value = true;
  await nextTick();
  window.scrollTo(0, 0);
  game = mountGame(
    gameEl.value!,
    engine.value,
    () => {
      tick.value++;
      const e = engine.value!;

      if (e.status !== "playing" && !settled) {
        settled = true;
        result.value = e.status;
        if (e.status === "won") {
          if (e.settings.difficulty !== "custom")
            save.win(levelId.value, e.coins);
          save.record(levelId.value, e.time, e.settings);
          audio.play("win");
        } else audio.play("lose");
      }
    },
    { audio, quality: () => save.data.quality, shake: () => save.data.shake },
  );
}
function home() {
  void exitBattleFullscreen();
  audio.stop();
  game?.destroy(true);
  game = undefined;
  engine.value = undefined;
  page.value = "home";
  playing.value = false;
  result.value = "";
  modal.value = "";
}
function selectSeed(id: string) {
  if (!engine.value || engine.value.paused || engine.value.status !== "playing")
    return;
  engine.value.selected = engine.value.selected === id ? "" : id;
  tick.value++;
  audio.play("click");
}
function pause() {
  if (engine.value?.status === "playing") {
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
      engine.value.selected = "";
      engine.value.cannon = 0;
    }
    if (full.value && !document.fullscreenElement) void exitBattleFullscreen();
    tick.value++;
  }
  if (e.key === "s" || e.key === "S") selectSeed("shovel");
  if (/^[1-9]$/.test(e.key)) {
    const ids = engine.value?.isBelt ? stats.value.belt : chosen.value;
    const id = ids[Number(e.key) - 1];
    if (id) selectSeed(id);
  }
}
onMounted(() => {
  audio.enabled = save.data.sound;
  audio.volume = save.data.volume;
  audio.mix = { ...save.data.mix };
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("fullscreenchange", fullscreenChanged);
  window.addEventListener("keydown", keyboard);
});
onBeforeUnmount(() => {
  game?.destroy(true);
  audio.dispose();
  document.removeEventListener("visibilitychange", visibility);
  document.removeEventListener("fullscreenchange", fullscreenChanged);
  document.body.classList.remove("battle-fullscreen");
  window.removeEventListener("keydown", keyboard);
});
</script>

<template>
  <div class="app-shell" :class="{ immersive: full && page === 'game' }">
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
          <div class="garden-tip">
            <span>园丁小贴士</span>
            <p>先种向日葵。<br />充足的阳光，是好防线的开始。</p>
            <img :src="pa('sunflower')" alt="" />
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
            <p class="hint">
              {{
                level.world === 1
                  ? "夜间没有自然掉落的阳光。记得带上阳光菇。"
                  : level.world === 2 || level.world === 3
                    ? "水路种植陆生植物前，需要先放置睡莲。"
                    : level.world === 4
                      ? "屋顶需要花盆。投手的抛物线能越过斜坡。"
                      : "先建立阳光生产，再用射手与坚果搭起防线。"
              }}
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
            <span class="kicker">{{ worlds[level.world].name }}</span>
            <h2>
              第 {{ level.label }} 关
              <small>{{
                level.mode === "normal"
                  ? "庭院防线"
                  : level.mode === "boss"
                    ? "最后的守护"
                    : "特别挑战"
              }}</small>
            </h2>
          </div>
          <div class="game-controls">
            <button class="plain" @click="sound">
              {{ save.data.sound ? "音效：开" : "音效：关" }}</button
            ><button class="plain" @click="fullscreen">全屏</button
            ><button class="plain" @click="pause">
              {{ stats.paused ? "继续游戏" : "暂停游戏" }}
            </button>
          </div>
        </section>
        <div class="game-frame">
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
              ><strong>{{ engine?.isBelt ? "传送带" : stats.sun }}</strong
              ><small>{{ engine?.isBelt ? "免费种植" : "阳光储备" }}</small>
            </div>
            <div class="battle-seeds">
              <button
                v-for="(id, i) in engine?.isBelt ? stats.belt : chosen"
                :key="id + '-' + i"
                class="battle-seed"
                :class="{
                  selected: stats.selected === id,
                  unavailable:
                    !engine?.isBelt &&
                    (stats.sun < engine!.getDef(id).cost ||
                      stats.cooldowns[id] > 0),
                }"
                @click="selectSeed(id)"
                :aria-label="'选择' + plantById[id].name"
                :aria-pressed="stats.selected === id"
              >
                <span class="key">{{ i + 1 }}</span
                ><img :src="pa(id)" :alt="plantById[id].name" /><span>{{
                  plantById[id].name
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
            <button
              class="shovel"
              :class="{ selected: stats.selected === 'shovel' }"
              @click="selectSeed('shovel')"
            >
              <span class="shovel-icon" aria-hidden="true">♠</span
              ><span>铲子</span>
            </button>
          </div>
          <div class="canvas-wrap">
            <div ref="gameEl" class="phaser-mount" aria-label="游戏草坪"></div>
            <div
              v-if="stats.message && !stats.paused && !result"
              class="game-message"
            >
              {{ stats.message }}
            </div>
            <div v-if="stats.paused && !modal && !result" class="game-overlay">
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
                      ? engine?.settings.difficulty === "custom"
                        ? "自定义挑战成绩已保存，不影响冒险解锁。"
                        : "通关进度已保存，下一段冒险在等你。"
                      : "试试多种阳光植物，及时补上薄弱的防线。"
                  }}
                </p>
                <button
                  class="primary"
                  @click="
                    result === 'won' &&
                    levelId < 50 &&
                    engine?.settings.difficulty !== 'custom'
                      ? chooseLevel(levelId + 1)
                      : start()
                  "
                >
                  {{
                    result === "won" &&
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
              <span>{{ level.mode === "boss" ? "僵王生命" : "僵尸进攻" }}</span>
              <div>
                <i
                  :style="{
                    width:
                      (level.mode === 'boss'
                        ? (stats.boss / (engine?.bossMax || 24000)) * 100
                        : stats.progress) + '%',
                  }"
                ></i>
              </div>
              <b>{{
                level.mode === "boss"
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
          点击种子，再点击草坪种植 · 点击阳光收集 · 空格暂停 · 数字键选卡 · S
          键切换铲子
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
              僵尸访客 · {{ zombies.length }}
            </button>
          </div>
          <div class="almanac-grid">
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
            />
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
  </div>
</template>
