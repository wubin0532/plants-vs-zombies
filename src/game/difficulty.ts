import { levels, type Level } from "./content";
export type Difficulty = "casual" | "standard" | "hard" | "custom";
export type BattleOptions = {
  difficulty: Difficulty;
  minutes: number;
  density: number;
  health: number;
  speed: number;
  sun: number;
  prep: number;
  mowers: boolean;
};
export const defaultOptions = (): BattleOptions => ({
  difficulty: "standard",
  minutes: 10,
  density: 1,
  health: 1,
  speed: 1,
  sun: 150,
  prep: 25,
  mowers: true,
});
const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : fallback;
export function normalizeOptions(
  input: Partial<BattleOptions> = {},
): BattleOptions {
  input = input && typeof input === "object" ? input : {};
  const d = defaultOptions();
  return {
    difficulty: ["casual", "standard", "hard", "custom"].includes(
      input.difficulty || "",
    )
      ? input.difficulty!
      : d.difficulty,
    minutes: clamp(input.minutes, 5, 30, 10),
    density: clamp(input.density, 0.5, 2, 1),
    health: clamp(input.health, 0.5, 2, 1),
    speed: clamp(input.speed, 0.75, 1.5, 1),
    sun: Math.round(clamp(input.sun, 0, 500, 150) / 25) * 25,
    prep: Math.round(clamp(input.prep, 10, 60, 25)),
    mowers: typeof input.mowers === "boolean" ? input.mowers : true,
  };
}
export function battleSettings(
  level: Level,
  input: Partial<BattleOptions> = {},
) {
  const o = normalizeOptions(input),
    preset =
      o.difficulty === "casual"
        ? [0.75, 0.85, 0.9]
        : o.difficulty === "hard"
          ? [1.3, 1.15, 1.1]
          : [1, 1, 1];
  const ranges = [
    [8, 10],
    [9, 11],
    [10, 12],
    [12, 14],
    [13, 15],
  ];
  const range = ranges[level.world];
  const normalMinutes =
    range[0] + ((range[1] - range[0]) * (level.stage - 1)) / 9;
  return {
    ...o,
    density: o.difficulty === "custom" ? o.density : preset[0],
    health: o.difficulty === "custom" ? o.health : preset[1],
    speed: o.difficulty === "custom" ? o.speed : preset[2],
    sun:
      o.difficulty === "custom" ? o.sun : o.difficulty === "casual" ? 200 : 150,
    prep:
      o.difficulty === "custom" ? o.prep : o.difficulty === "hard" ? 18 : 25,
    mowers: o.difficulty === "custom" ? o.mowers : true,
    duration: Math.round(
      (o.difficulty === "custom"
        ? o.minutes
        : level.mode === "normal"
          ? normalMinutes
          : level.mode === "boss"
            ? 10
            : level.mode === "vases"
              ? 6
              : 5 + level.world * 0.5) * 60,
    ),
  };
}
export type SpawnEvent = { at: number; id: string; wave: number };
export function makeWaves(
  level: Level,
  settings: ReturnType<typeof battleSettings>,
): SpawnEvent[] {
  if (["boss", "vases"].includes(level.mode)) return [];
  const n = Math.max(8, Math.round(settings.duration / 32)),
    end = settings.duration - 45,
    result: SpawnEvent[] = [];
  for (let wave = 0; wave < n; wave++) {
    const progress = wave / (n - 1);
    const count = Math.max(
      1,
      Math.round(
        (2 + level.world * 0.7 + level.stage * 0.18) *
          (0.6 + progress * 0.7 + progress * progress * 0.6) *
          (wave >= n - 3 ? 1.6 : 1) *
          settings.density,
      ),
    );
    const start = settings.prep + (end - settings.prep) * progress;
    const unlocked = level.enemies.slice(
      0,
      Math.max(
        1,
        Math.ceil(level.enemies.length * Math.min(1, 0.3 + progress)),
      ),
    );
    for (let j = 0; j < count; j++) {
      let id = unlocked[(wave * 7 + j * 3) % unlocked.length];
      if (level.mode === "whack") id = (wave + j) % 4 === 0 ? "cone" : "basic";
      if (j === 0 && (wave % 4 === 3 || wave === n - 1)) id = "flag";
      result.push({ at: Math.min(end, start + j * 0.8), id, wave: wave + 1 });
    }
  }
  return result.sort((a, b) => a.at - b.at);
}
export function levelDuration(
  id: number,
  options: Partial<BattleOptions> = {},
) {
  return battleSettings(levels[id - 1], options).duration;
}
