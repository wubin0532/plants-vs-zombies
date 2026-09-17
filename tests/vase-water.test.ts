import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";

/** 35 关：迷雾砸罐，6 行，2/3 行为水路。 */
const vases = () => new Engine(35, []);

describe("砸罐关水路罐", () => {
  it("水路罐只开出水生僵尸，陆路罐只开陆行僵尸", () => {
    const e = vases();
    const waterVases = e.tiles.filter(
      (t) => t.type === "vase" && (t.row === 2 || t.row === 3),
    );
    expect(waterVases.length).toBeGreaterThan(0);
    for (const t of [...waterVases]) e.click(t.row, t.col);
    const waterSpawned = e.zombies;
    expect(waterSpawned.length).toBeGreaterThan(0); // 固定种子下至少开出一个
    for (const z of waterSpawned) {
      expect(["ducky", "snorkel"]).toContain(z.id);
      expect(e.water(z.row)).toBe(true);
    }

    const f = vases();
    const landVases = f.tiles.filter(
      (t) => t.type === "vase" && !f.water(t.row) && !t.reward,
    );
    for (const t of [...landVases]) f.click(t.row, t.col);
    expect(f.zombies.length).toBeGreaterThan(0);
    for (const z of f.zombies) expect(["basic", "bucket"]).toContain(z.id);
  });

  it("水路罐的植物奖励仍然是缠绕海草", () => {
    const e = vases();
    // 开完所有水路罐后，传送带里的植物奖励只能是海草（水路）或标记罐种子。
    for (const t of [
      ...e.tiles.filter((t) => t.type === "vase" && (t.row === 2 || t.row === 3)),
    ])
      e.click(t.row, t.col);
    for (const id of e.conveyor) expect(["kelp"]).toContain(id);
  });
});
