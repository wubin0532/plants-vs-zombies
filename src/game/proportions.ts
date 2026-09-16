/** Visual proportions do not change tile occupancy or combat range. */
const plants: Record<string, number> = {
  chomper: 1.35,
  squash: 1.18,
  tallnut: 1.2,
  cob: 1.45,
  doom: 1.2,
  melon: 1.12,
  winter: 1.15,
  cattail: 1.12,
};
const zombies: Record<string, number> = {
  garg: 1.65,
  pole: 1.2,
  football: 1.22,
  ladder: 1.15,
  dancer: 1.12,
  balloon: 1.12,
  zomboni: 1.3,
  catapult: 1.3,
  bobsled: 1.25,
  imp: 0.67,
};
export const plantScale = (id: string) => plants[id] ?? 1;
export const zombieScale = (id: string) => zombies[id] ?? 1;
