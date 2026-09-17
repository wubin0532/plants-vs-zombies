/**
 * 通关重玩判定：读取本地存档（store.ts 的 persist key）里的 completed 列表。
 * 引擎不反向依赖 store（pinia），只在浏览器环境做一次只读的本地查询；
 * 测试 / SSR 等没有 localStorage 的环境一律视为未通关，行为与此前一致。
 */
export function levelCleared(id: number): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem("pvz-garden-save-v1");
    if (!raw) return false;
    const data = JSON.parse(raw) as { completed?: unknown };
    return Array.isArray(data.completed) && data.completed.includes(id);
  } catch {
    return false;
  }
}

/**
 * 重玩散列位移：同一关每次重玩种子固定，单靠 LCG 会让雪人“要么永远出现、
 * 要么永不出现”。这里持久化一个递增计数，按黄金比例散布到 [0,1)，
 * 让每次重玩独立掷签。无存储环境返回 0（退回种子内确定性结果）。
 */
export function replayShift(): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    const key = "pvz-yeti-nonce";
    const n = Number(localStorage.getItem(key) ?? 0) || 0;
    localStorage.setItem(key, String(n + 1));
    return (n * 0.6180339887) % 1;
  } catch {
    return 0;
  }
}
