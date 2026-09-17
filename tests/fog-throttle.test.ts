import { describe, it, expect } from "vitest";
import { fogRefreshInterval } from "../src/game/fog-render";

describe("迷雾遮罩重算节流", () => {
  it("三档画质都有帧级节流，低画质最省", () => {
    const low = fogRefreshInterval("low");
    const medium = fogRefreshInterval("medium");
    const high = fogRefreshInterval("high");
    expect(low).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThanOrEqual(high);
  });
  it("节流间隔在慢变化不可感知的范围内（30~120ms）", () => {
    for (const q of ["low", "medium", "high"]) {
      const interval = fogRefreshInterval(q);
      expect(interval).toBeGreaterThanOrEqual(0.03);
      expect(interval).toBeLessThanOrEqual(0.12);
    }
  });
});
