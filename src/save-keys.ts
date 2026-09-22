/**
 * 本机存档的键方案。
 *
 * 背景：早先整个浏览器只用一个全局存档 key，导致同一台手机上
 * 换账号（或新注册）时会把上一个账号的进度当成新账号的进度上传。
 * 现在每个"归属"（访客 guest / 各账号 user.id）各占一个键槽，
 * 并由 ACTIVE_PROFILE_KEY 记录当前正在使用的归属，供 UI 层（replay.ts）
 * 与 store 共用同一份存档。
 */
export const GUEST_PROFILE = "guest";
export const LEGACY_SAVE_KEY = "pvz-garden-save-v1";
export const LEGACY_SYNCED_KEY = "pvz-garden-save-synced-at";
export const ACTIVE_PROFILE_KEY = "pvz-garden-active-profile";

/** 某归属的本机存档键。 */
export function saveKeyFor(profile: string): string {
  return LEGACY_SAVE_KEY + "::" + profile;
}

/** 某归属已见到的服务端修订号键。 */
export function syncedAtKeyFor(profile: string): string {
  return LEGACY_SYNCED_KEY + "::" + profile;
}

/**
 * 当前活跃归属；未设置或读取失败时回退访客档。
 *
 * localStorage 是跨标签共享的，可能在别处被改写；而 store 内存里的 profile 才是
 * 本标签页的权威归属。只读 localStorage 会让 replay.ts 这类纯读取方在「内存归属
 * 已切换、跨标签 storage 事件还没到」的窗口里读到别的槽，因此 store 已挂载时
 * 一律以它为准（不在这里 import store，避免与 store 形成循环依赖）。
 */
export function readActiveProfile(): string {
  const live = liveProfile();
  if (live) return live;
  try {
    if (typeof localStorage === "undefined") return GUEST_PROFILE;
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || GUEST_PROFILE;
  } catch {
    return GUEST_PROFILE;
  }
}

/** 由 store 侧注册的「当前内存归属」取值器；未挂载 store 时为 undefined。 */
let liveProfileReader: (() => string | undefined) | undefined;
export function setLiveProfileReader(reader: () => string | undefined): void {
  liveProfileReader = reader;
}
function liveProfile(): string | undefined {
  try {
    return liveProfileReader?.();
  } catch {
    return undefined;
  }
}

/** 记录当前活跃归属（切换账号 / 登出时调用）。 */
export function writeActiveProfile(profile: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ACTIVE_PROFILE_KEY, profile);
  } catch {
    /* 存储不可用时无所谓：store 内存里仍有 profile */
  }
}

/** 当前活跃归属对应的本机存档键，供 levelCleared 等 UI 层只读逻辑使用。 */
export function activeSaveKey(): string {
  return saveKeyFor(readActiveProfile());
}
