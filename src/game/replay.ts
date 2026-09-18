import { activeSaveKey, readActiveProfile } from "../save-keys";

/**
 * 通关重玩判定：读取"当前归属"（访客 / 登录账号）本机存档里的 completed 列表。
 * 只允许在 UI 层（App.vue）调用；规则引擎本身不读任何持久化状态，
 * 以保证同一 (seed, replay, replayAttempt) 必定得到同一战场。
 */
export function levelCleared(id: number): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(activeSaveKey());
    if (!raw) return false;
    const data = JSON.parse(raw) as { completed?: unknown };
    return Array.isArray(data.completed) && data.completed.includes(id);
  } catch {
    return false;
  }
}

/**
 * 取并递增"本关重玩次数"，用于让同一关的多次重玩各自独立掷雪人签。
 * 计数只存在于 UI 层的 localStorage，不参与引擎求解。
 */
export function nextReplayAttempt(levelId: number): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    const key = "pvz-yeti-attempt-" + readActiveProfile() + "-" + levelId;
    const n = Number(localStorage.getItem(key) ?? 0) || 0;
    localStorage.setItem(key, String(n + 1));
    return n;
  } catch {
    return 0;
  }
}

/**
 * 纯函数：由 (seed, 重玩次数) 确定性地推导散列位移，落在 [0,1)。
 * attempt=0 返回 0，保持"首次重玩"与此前固定种子结果一致；
 * attempt>0 才产生新的掷签，且完全可复现，不写任何存储。
 */
export function replayShiftFor(seed: number, attempt: number): number {
  if (!attempt) return 0;
  const mixed = Math.imul((seed ^ Math.imul(attempt, 2654435761)) >>> 0, 2246822519) >>> 0;
  return (mixed % 1000) / 1000;
}
