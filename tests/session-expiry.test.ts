import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAuth } from "../src/auth";
import { useSave } from "../src/store";
import { GUEST_PROFILE, saveKeyFor, ACTIVE_PROFILE_KEY } from "../src/save-keys";
import { api } from "../src/api";

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

const save = JSON.stringify({
  version: 2,
  completed: [1, 2],
  unlocked: 3,
  coins: 10,
  sound: true,
});

describe("会话失效后的归属一致性", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("任意接口 401 会清空登录态（api 的集中处理已接线）", async () => {
    stubStorage();
    const auth = useAuth();
    auth.user = { id: "u_a", name: "a", createdAt: 1 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );

    await expect(api.getSave()).rejects.toThrow();
    expect(auth.user).toBeNull();
  });

  it("exitProfile 切回访客档并让持久化落到访客槽", () => {
    const store = stubStorage({
      [saveKeyFor("u_a")]: save,
      [saveKeyFor(GUEST_PROFILE)]: save,
    });
    const s = useSave();
    s.load("u_a");
    expect(s.profile).toBe("u_a");

    s.exitProfile();
    expect(s.profile).toBe(GUEST_PROFILE);
    expect(store.get(ACTIVE_PROFILE_KEY)).toBe(GUEST_PROFILE);

    // 之后任何写入都必须落在访客槽，不再碰旧账号的槽。
    const before = store.get(saveKeyFor("u_a"));
    s.data.coins = 99;
    s.persist();
    expect(store.get(saveKeyFor("u_a"))).toBe(before);
    expect(
      (JSON.parse(store.get(saveKeyFor(GUEST_PROFILE))!) as { coins: number })
        .coins,
    ).toBe(99);
  });
});
