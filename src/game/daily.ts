import { levels, plants, isNight } from "./content";
export type DailyChallenge = {
  date: string;
  seed: number;
  levelId: number;
  cards: string[];
};
export function dailyChallenge(date: Date, unlocked: number): DailyChallenge {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  let rng = Number(dateStr) || 1;
  const rand = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const pool = levels.filter((l) => l.id <= Math.max(1, unlocked));
  const level = pool[Math.floor(rand() * pool.length)];
  const sun = isNight(level.scene) ? "sunshroom" : "sunflower";
  const count = 6 + Math.floor(rand() * 3);
  const bag = plants
    .filter((p) => !p.upgrade && p.id !== "imitater" && p.id !== sun)
    .map((p) => p.id);
  const cards = [sun];
  while (cards.length < count && bag.length)
    cards.push(bag.splice(Math.floor(rand() * bag.length), 1)[0]);
  return { date: dateStr, seed: Number(dateStr), levelId: level.id, cards };
}
