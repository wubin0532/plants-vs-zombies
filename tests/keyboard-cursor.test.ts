import { describe, it, expect } from "vitest";
import { Engine } from "../src/game/engine";

describe("键盘光标", () => {
  it("初始无光标，方向键从草坪中央唤出并移动", () => {
    const e = new Engine(1, ["pea"]);
    expect(e.cursor).toBeNull();
    e.moveCursor(0, 1);
    expect(e.cursor).toEqual({ row: 2, col: 5 });
    e.moveCursor(-1, 0);
    expect(e.cursor).toEqual({ row: 1, col: 5 });
  });
  it("光标被夹取在关卡网格内（含六行关卡）", () => {
    const e = new Engine(1, ["pea"]);
    e.moveCursor(0, 0);
    for (let i = 0; i < 10; i++) e.moveCursor(-1, -1);
    expect(e.cursor).toEqual({ row: 0, col: 0 });
    for (let i = 0; i < 10; i++) e.moveCursor(1, 1);
    expect(e.cursor).toEqual({ row: 4, col: 8 });
    const pool = new Engine(21, ["pea"]);
    pool.moveCursor(0, 0);
    for (let i = 0; i < 10; i++) pool.moveCursor(1, 0);
    expect(pool.cursor).toEqual({ row: 5, col: 4 });
  });
  it("保龄球模式不出现光标", () => {
    const e = new Engine(5, ["wallnut"]);
    expect(e.level.mode).toBe("bowling");
    e.moveCursor(0, 1);
    expect(e.cursor).toBeNull();
  });
  it("回车在光标格种植，与指针同一入口：扣阳光、清选择", () => {
    const e = new Engine(1, ["pea"]);
    e.moveCursor(0, 0);
    e.cursor = { row: 1, col: 2 };
    e.selected = "pea";
    e.cursorAction();
    expect(e.at(1, 2, "main")?.id).toBe("pea");
    expect(e.sun).toBe(50);
    expect(e.selected).toBe("");
  });
  it("种植失败的反馈与指针一致：不扣资源并提示原因", () => {
    const e = new Engine(1, ["pea"]);
    e.moveCursor(0, 0);
    e.sun = 0;
    e.selected = "pea";
    e.cursorAction();
    expect(e.plants).toHaveLength(0);
    expect(e.selected).toBe("pea");
    expect(e.message).toContain("阳光不足");
  });
  it("暂停或结束后回车不操作", () => {
    const e = new Engine(1, ["pea"]);
    e.moveCursor(0, 0);
    e.selected = "pea";
    e.paused = true;
    e.cursorAction();
    expect(e.plants).toHaveLength(0);
    e.paused = false;
    e.status = "lost";
    e.cursorAction();
    expect(e.plants).toHaveLength(0);
  });
  it("无光标时回车不做任何事", () => {
    const e = new Engine(1, ["pea"]);
    e.selected = "pea";
    e.cursorAction();
    expect(e.plants).toHaveLength(0);
    expect(e.sun).toBe(150);
  });
  it("选中铲子后回车铲除光标格的植物", () => {
    const e = new Engine(1, ["pea"]);
    e.addPlant("pea", 2, 4);
    e.moveCursor(0, 0);
    e.cursor = { row: 2, col: 4 };
    e.selected = "shovel";
    e.cursorAction();
    expect(e.plants).toHaveLength(0);
  });
  it("打地鼠模式回车在光标格挥锤", () => {
    const e = new Engine(15, []);
    expect(e.level.mode).toBe("whack");
    e.spawn("basic", 2, 4);
    const z = e.zombies.at(-1)!;
    const hp = z.hp;
    e.moveCursor(0, 0);
    e.cursor = { row: 2, col: 4 };
    e.cursorAction();
    expect(z.hp).toBeLessThan(hp);
    expect(z.freeze).toBeGreaterThan(0);
  });
  it("砸罐模式回车敲开光标格的罐子", () => {
    const e = new Engine(35, []);
    expect(e.level.mode).toBe("vases");
    e.moveCursor(0, 0);
    e.cursor = { row: 0, col: 4 };
    e.cursorAction();
    expect(e.tiles.some((t) => t.row === 0 && t.col === 4)).toBe(false);
    expect(e.conveyor).toContain("snowpea");
  });
});
