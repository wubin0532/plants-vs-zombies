import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { initial, useSave } from "../src/store";
import { useAuth } from "../src/auth";
import { GUEST_PROFILE, saveKeyFor } from "../src/save-keys";

// 云端状态与"当前登录用户"由测试控制；vi.hoisted 保证 mock 工厂可以引用。
const h = vi.hoisted(() => ({
  cloud: new Map<string, { updatedAt: number; data: unknown }>(),
  current: "",
}));

vi.mock("../src/api", () => {
  class ApiError extends Error {
    status: number;
    payload: unknown;
    constructor(status: number, message: string, payload?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.payload = payload;
    }
  }
  return {
    ApiError,
    setUnauthorizedHandler: vi.fn(),
    api: {
      me: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      getSave: vi.fn(async () => ({ save: h.cloud.get(h.current) ?? null })),
      putSave: vi.fn(async (data: unknown, baseUpdatedAt?: number) => {
        const existing = h.cloud.get(h.current) ?? null;
        if (
          existing &&
          baseUpdatedAt !== undefined &&
          existing.updatedAt > baseUpdatedAt
        ) {
          throw new ApiError(409, "conflict", { save: existing });
        }
        const updatedAt = (existing ? existing.updatedAt : 0) + 1;
        h.cloud.set(h.current, {
          updatedAt,
          data: JSON.parse(JSON.stringify(data)),
        });
        return { updatedAt };
      }),
    },
  };
});

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

const progressSave = (completed: number[]) => ({
  ...initial(),
  completed,
  unlocked: Math.min(51, completed.length + 1),
});

const setUser = (id: string) => {
  const auth = useAuth();
  auth.user = { id, name: id, createdAt: 1 };
  h.current = id;
  return auth;
};

describe("同机多账号存档隔离", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.cloud.clear();
    h.current = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("访客有进度时进入新账号：默认返回 claim，不自动继承", async () => {
    stubStorage({
      [saveKeyFor(GUEST_PROFILE)]: JSON.stringify(progressSave([1, 2, 3])),
    });
    const save = useSave();
    setUser("u_b");
    expect(await save.enterProfile("u_b")).toBe("claim");
    // 内存里是账号自己的空档，已经是访客进度就说明串档了
    expect(save.data.completed).toEqual([]);
    // 确认前绝不写云端
    expect(h.cloud.get("u_b")).toBeUndefined();
  });

  it("选择不带入：云档为空，访客档原样保留", async () => {
    const store = stubStorage({
      [saveKeyFor(GUEST_PROFILE)]: JSON.stringify(progressSave([1, 2, 3])),
    });
    const save = useSave();
    setUser("u_b");
    expect(await save.enterProfile("u_b")).toBe("claim");
    await save.resolveClaim(false);
    expect(h.cloud.get("u_b")?.data).toMatchObject({ completed: [] });
    expect(JSON.parse(store.get(saveKeyFor(GUEST_PROFILE))!)).toMatchObject({
      completed: [1, 2, 3],
    });
  });

  it("选择带入：才把访客进度合并进账号并上传", async () => {
    stubStorage({
      [saveKeyFor(GUEST_PROFILE)]: JSON.stringify(progressSave([1, 2, 3])),
    });
    const save = useSave();
    setUser("u_b");
    expect(await save.enterProfile("u_b")).toBe("claim");
    await save.resolveClaim(true);
    expect(save.data.completed).toEqual([1, 2, 3]);
    expect(h.cloud.get("u_b")?.data).toMatchObject({ completed: [1, 2, 3] });
  });

  it("已有云档的账号只合并自己的档，不吸收访客进度", async () => {
    stubStorage({
      [saveKeyFor(GUEST_PROFILE)]: JSON.stringify(progressSave([1, 2, 3])),
    });
    h.cloud.set("u_a", { updatedAt: 5, data: progressSave([1, 2]) });
    const save = useSave();
    setUser("u_a");
    expect(await save.enterProfile("u_a")).toBe("ok");
    expect(save.data.completed).toEqual([1, 2]);
  });

  it("A 游玩并登出后再进 B：B 看不到 A 的进度", async () => {
    stubStorage();
    const save = useSave();
    const auth = setUser("u_a");
    await save.enterProfile("u_a");
    save.win(1, 10);
    save.win(2, 10);
    save.win(3, 10);
    await save.pushCloud(true);
    expect(h.cloud.get("u_a")?.data).toMatchObject({ completed: [1, 2, 3] });

    await auth.logout();
    save.exitProfile();
    expect(save.profile).toBe(GUEST_PROFILE);

    setUser("u_b");
    expect(await save.enterProfile("u_b")).toBe("ok");
    expect(save.data.completed).toEqual([]);
    expect(h.cloud.get("u_b")?.data).toMatchObject({ completed: [] });
  });

  it("旧全局存档迁移为访客档", () => {
    stubStorage({
      "pvz-garden-save-v1": JSON.stringify(progressSave([1, 2, 3, 4])),
    });
    const save = useSave();
    save.load();
    expect(save.profile).toBe(GUEST_PROFILE);
    expect(save.data.completed).toEqual([1, 2, 3, 4]);
    expect(
      JSON.parse(localStorage.getItem(saveKeyFor(GUEST_PROFILE))!),
    ).toMatchObject({ completed: [1, 2, 3, 4] });
  });
});
