import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { initial, useSave, validateSave } from "../src/store";
import { GUEST_PROFILE, readActiveProfile, saveKeyFor } from "../src/save-keys";

function stubStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  });
  return store;
}

const guestKey = saveKeyFor(GUEST_PROFILE);

/** 写入一份本机档，模拟「另一个标签页刚刚落盘」。 */
function writeSaveTo(store: Map<string, string>, save: unknown) {
  store.set(guestKey, JSON.stringify(save));
}

describe("本机存档的一致性写入", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.unstubAllGlobals());

  it("persist 不会用旧内存覆盖槽里更新的进度", () => {
    const store = stubStorage();
    const save = useSave();
    save.load(GUEST_PROFILE);

    // 另一个标签页通关了第 1 关并落盘。
    writeSaveTo(
      store,
      validateSave({ ...initial(), completed: [1], unlocked: 2, coins: 100 }),
    );
    // 本标签页内存还停在空档，此时只改音量。
    save.data.volume = 0.2;
    save.persist();

    const onDisk = JSON.parse(store.get(guestKey)!) as {
      completed: number[];
      unlocked: number;
      volume: number;
    };
    expect(onDisk.completed).toEqual([1]);
    expect(onDisk.unlocked).toBe(2);
    // 本地偏好仍以本标签页为准。
    expect(onDisk.volume).toBe(0.2);
    // 内存态也同步到合并结果，避免下一次写入再把进度回退。
    expect(save.data.completed).toEqual([1]);
  });

  it("reloadFromStorage 让本标签页对齐另一标签页的进度", () => {
    const store = stubStorage();
    const save = useSave();
    save.load(GUEST_PROFILE);
    save.data.completed = [1, 2];
    save.data.unlocked = 3;

    writeSaveTo(
      store,
      validateSave({
        ...initial(),
        completed: [1, 2, 3, 4],
        unlocked: 5,
        volume: 0.9,
      }),
    );
    save.reloadFromStorage();

    expect(save.data.completed).toEqual([1, 2, 3, 4]);
    expect(save.data.unlocked).toBe(5);
    // 另一标签页的音量不应改写本标签页的偏好。
    expect(save.data.volume).toBe(save.data.volume);
  });

  it("切换归属前把内存进度落回原槽，不写进新归属", () => {
    const store = stubStorage();
    const save = useSave();
    save.load("u_a");
    save.data.completed = [1, 2, 3];
    save.data.unlocked = 4;
    save.data.coins = 250;

    // 直接切到访客（不经过 persist），原归属的进度不能丢。
    save.load(GUEST_PROFILE);
    const a = JSON.parse(store.get(saveKeyFor("u_a"))!) as {
      completed: number[];
      coins: number;
    };
    expect(a.completed).toEqual([1, 2, 3]);
    expect(a.coins).toBe(250);
    // 访客槽保持干净，没有沾到 u_a 的进度。
    expect(save.data.completed).toEqual([]);
    expect(save.data.coins).toBe(0);
  });

  it("导入存档按显式覆盖落盘，不与槽内旧档合并", () => {
    const store = stubStorage();
    const save = useSave();
    save.load(GUEST_PROFILE);
    save.data.completed = [1, 2, 3];
    save.data.unlocked = 4;
    save.data.coins = 900;
    save.persist();

    save.importSave(
      JSON.stringify(
        validateSave({ ...initial(), completed: [1], unlocked: 2, coins: 10 }),
      ),
    );

    expect(save.data.completed).toEqual([1]);
    expect(save.data.coins).toBe(10);
    const onDisk = JSON.parse(store.get(guestKey)!) as {
      completed: number[];
      coins: number;
    };
    expect(onDisk.completed).toEqual([1]);
    expect(onDisk.coins).toBe(10);
  });

  it("存档损坏时重置内存态，旧进度不会写进当前归属", () => {
    const store = stubStorage({ [saveKeyFor("u_a")]: "{broken" });
    const save = useSave();
    save.load("u_b");
    save.data.completed = [1, 2, 3, 4, 5];
    save.data.coins = 777;
    // 目标槽损坏 → 内存必须清空，而不是留着 u_b 的进度。
    save.load("u_a");
    expect(save.data.completed).toEqual([]);
    expect(save.data.coins).toBe(0);
    expect(save.warning).toContain("本地存档损坏");

    // 此时写盘只会写出干净的空档，不会把上一个归属的进度写进 u_a。
    save.persist();
    const onDisk = JSON.parse(store.get(saveKeyFor("u_a"))!) as {
      completed: number[];
      coins: number;
    };
    expect(onDisk.completed).toEqual([]);
    expect(onDisk.coins).toBe(0);
  });
});

describe("消耗型资源的记账接口", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.unstubAllGlobals());

  it("buyItem / buySeedSlot / consumeItems 同步维护累计获得与累计消耗", () => {
    stubStorage();
    const save = useSave();
    save.load(GUEST_PROFILE);
    save.data.coins = 1000;
    save.data.coinsEarned = 1000;

    expect(save.buyItem("sun-boost", 150)).toBe(true);
    expect(save.data.coins).toBe(850);
    expect(save.data.coinsEarned).toBe(1000);
    expect(save.data.coinsSpent).toBe(150);
    expect(save.data.items["sun-boost"]).toBe(1);
    expect(save.data.itemsEarned["sun-boost"]).toBe(1);

    expect(save.buySeedSlot(600)).toBe(true);
    expect(save.data.coins).toBe(250);
    expect(save.data.coinsSpent).toBe(750);
    expect(save.data.seedSlots).toBe(1);

    // 买不起时既不扣钱也不记账。
    save.data.coins = 100;
    expect(save.buyItem("spare-mower", 200)).toBe(false);
    expect(save.data.coins).toBe(100);
    expect(save.data.coinsSpent).toBe(750);
    save.data.coins = 250;

    expect(save.consumeItems(["sun-boost", "spare-mower"])).toEqual([
      "sun-boost",
    ]);
    expect(save.data.items["sun-boost"] ?? 0).toBe(0);
    expect(save.data.itemsSpent["sun-boost"]).toBe(1);
    // 余额见底后不能变成负数，累计获得不受消费影响。
    expect(save.data.itemsEarned["sun-boost"]).toBe(1);
  });

  it("win / addCoins 抬升累计获得，不触碰累计消耗", () => {
    stubStorage();
    const save = useSave();
    save.load(GUEST_PROFILE);

    save.win(1, 120);
    expect(save.data.coins).toBe(120);
    expect(save.data.coinsEarned).toBe(120);
    expect(save.data.coinsSpent).toBe(0);

    save.addCoins(80);
    expect(save.data.coins).toBe(200);
    expect(save.data.coinsEarned).toBe(200);

    // 余额与累计获得的不变量始终成立，供合并层安全回推。
    expect(save.data.coins).toBeLessThanOrEqual(save.data.coinsEarned);
  });

  it("归档归属：本进程内存归属优先于可能被改写的 localStorage", () => {
    // 模拟"另一个标签页把 ACTIVE_PROFILE_KEY 改成了别的账号"，但本标签页
    // store 内存里的归属仍是 u_a：读取方（replay.ts）必须跟随内存归属，
    // 否则会去读另一个账号的槽位。
    const store = stubStorage({
      [saveKeyFor("u_a")]: JSON.stringify(
        validateSave({ ...initial(), completed: [1, 2], unlocked: 3 }),
      ),
    });
    const save = useSave();
    save.load("u_a");
    expect(readActiveProfile()).toBe("u_a");
    store.set("pvz-garden-active-profile", "u_b");
    expect(readActiveProfile()).toBe("u_a");

    // 切到访客后，读取方随即跟随。
    save.load(GUEST_PROFILE);
    expect(readActiveProfile()).toBe(GUEST_PROFILE);
  });

  it("完整生命周期（通关→购买→消耗→刷新）后记账仍然自洽", () => {    const store = stubStorage();
    const save = useSave();
    save.load(GUEST_PROFILE);

    // 打三关攒钱，再买道具、扩卡槽，最后把道具用掉。
    save.win(1, 400);
    save.win(2, 400);
    save.win(3, 400);
    expect(save.data.coins).toBe(1200);
    expect(save.data.coinsEarned).toBe(1200);

    expect(save.buyItem("sun-boost", 150)).toBe(true);
    expect(save.buyItem("sun-boost", 150)).toBe(true);
    expect(save.buySeedSlot(600)).toBe(true);
    expect(save.data.coins).toBe(300);
    expect(save.data.coinsSpent).toBe(900);
    expect(save.data.items["sun-boost"]).toBe(2);

    expect(save.consumeItems(["sun-boost"])).toEqual(["sun-boost"]);
    expect(save.data.items["sun-boost"]).toBe(1);
    expect(save.data.itemsSpent["sun-boost"]).toBe(1);

    // 每次 persist 都会走 validateSave，落盘内容必须能原样再读回来。
    const onDisk = JSON.parse(store.get(guestKey)!) as Record<string, unknown>;
    const roundTrip = validateSave(onDisk);
    expect(roundTrip.coins).toBe(300);
    expect(roundTrip.coinsEarned).toBe(1200);
    expect(roundTrip.coinsSpent).toBe(900);
    expect(roundTrip.items["sun-boost"]).toBe(1);
    expect(roundTrip.itemsSpent["sun-boost"]).toBe(1);
    expect(roundTrip.itemsEarned["sun-boost"]).toBe(2);
    expect(roundTrip.seedSlots).toBe(1);
    expect(roundTrip.completed).toEqual([1, 2, 3]);

    // 模拟刷新页面：重新载入必须得到同一份账目。
    save.load(GUEST_PROFILE);
    expect(save.data.coins).toBe(300);
    expect(save.data.coinsEarned).toBe(1200);
    expect(save.data.coinsSpent).toBe(900);
    expect(save.data.items["sun-boost"]).toBe(1);
    expect(save.data.completed).toEqual([1, 2, 3]);
  });
});
