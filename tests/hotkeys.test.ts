import { describe, it, expect } from "vitest";
import { seedHotkeyIndex, seedHotkeyLabel } from "../src/hotkeys";

describe("卡槽键位编号与数字键映射一一对应", () => {
  it("0..9 号卡槽显示 1..9、0", () => {
    expect(seedHotkeyLabel(0)).toBe("1");
    expect(seedHotkeyLabel(8)).toBe("9");
    // 第 10 张（卡槽上限 10）显示 0，正好对应键盘的 0。
    expect(seedHotkeyLabel(9)).toBe("0");
  });

  it("数字键回到卡槽序号，非数字键返回 -1", () => {
    expect(seedHotkeyIndex("1")).toBe(0);
    expect(seedHotkeyIndex("9")).toBe(8);
    expect(seedHotkeyIndex("0")).toBe(9);
    for (const key of ["s", "S", "Space", "ArrowUp", "Enter", "10", "", "a"])
      expect(seedHotkeyIndex(key)).toBe(-1);
  });

  it("卡面显示的编号就是按下去生效的键（往返一致）", () => {
    for (let index = 0; index < 10; index++)
      expect(seedHotkeyIndex(seedHotkeyLabel(index))).toBe(index);
  });
});
