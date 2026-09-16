import { levels, plants, isNight, isMushroom } from "./content";
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
  // 按场景保证必要植物：泳池/浓雾必须有睡莲，屋顶必须有花盆，
  // 否则可能抽到无法正常布防的死局卡池。
  const required: string[] = [];
  if (["pool", "fog"].includes(level.scene)) required.push("lily");
  if (level.scene === "roof") required.push("pot");
  for (const need of required) {
    if (cards.includes(need)) continue;
    // 优先替换末尾的非必需卡，保持卡池数量与确定性。
    const slot = cards
      .map((id, i) => ({ id, i }))
      .reverse()
      .find((c) => c.i > 0 && !required.includes(c.id));
    if (slot) cards[slot.i] = need;
    else cards.push(need);
  }
  // 除睡莲/花盆外，卡池还必须有场景中可工作的攻击方案：
  // 白天关卡里蘑菇全部休眠，若卡池又没有咖啡豆，纯蘑菇火力就是死局。
  const attackKinds = new Set([
    "electric",
    "shooter",
    "shroom",
    "lob",
    "homing",
    "fume",
    "gloom",
    "star",
    "spike",
  ]);
  const night = isNight(level.scene);
  const works = (id: string) => {
    const d = plants.find((p) => p.id === id);
    if (!d || !attackKinds.has(d.kind)) return false;
    if (!night && isMushroom(id) && !cards.includes("coffee")) return false;
    return true;
  };
  if (!cards.some(works)) {
    const candidates = plants.filter(
      (p) =>
        attackKinds.has(p.kind) &&
        !p.upgrade &&
        !cards.includes(p.id) &&
        (night || !isMushroom(p.id)),
    );
    if (candidates.length) {
      const pick = candidates[Math.floor(rand() * candidates.length)];
      const slot = cards
        .map((id, i) => ({ id, i }))
        .reverse()
        .find((c) => c.i > 0 && !required.includes(c.id));
      if (slot) cards[slot.i] = pick.id;
      else cards.push(pick.id);
    }
  }
  return { date: dateStr, seed: Number(dateStr), levelId: level.id, cards };
}
