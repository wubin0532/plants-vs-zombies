/**
 * 精灵图集切图算法（连通域 + 全局贪心匹配 + 粘连最小割）。
 * 抽成独立模块，既供 scripts/prepare-assets.mjs 使用，也供回归测试直接断言。
 */
import sharp from "sharp";

export const ALPHA_MIN = 16; // 判定为内容的 alpha 阈值
export const MIN_AREA = 150; // 过滤碎屑
export const PAD = 6; // 裁切外扩
export const CLAIM_SHARE = 0.06; // 连通域内某格像素占比超过该值即认领

const smooth = (t) => t * t * (3 - 2 * t);

/** 对图集做 alpha 连通域标记，返回每个连通域的包围盒与像素索引。 */
export async function labelComponents(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width,
    H = info.height,
    C = info.channels;
  const seen = new Uint8Array(W * H);
  const comps = [];
  const opaque = (i) => data[i * C + 3] > ALPHA_MIN;
  for (let y0 = 0; y0 < H; y0++)
    for (let x0 = 0; x0 < W; x0++) {
      const start = y0 * W + x0;
      if (seen[start] || !opaque(start)) continue;
      const stack = [start];
      seen[start] = 1;
      let minX = x0, maxX = x0, minY = y0, maxY = y0, area = 0;
      const pixels = [];
      while (stack.length) {
        const p = stack.pop();
        const px = p % W,
          py = (p - px) / W;
        area++;
        pixels.push(p);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx,
              ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const q = ny * W + nx;
            if (!seen[q] && opaque(q)) {
              seen[q] = 1;
              stack.push(q);
            }
          }
      }
      if (area >= MIN_AREA) comps.push({ area, minX, minY, maxX, maxY, pixels });
    }
  return { W, H, comps };
}

/** 在两条标称格中心之间找实心像素最少的一行/一列，作为粘连精灵的分割线。 */
export function minCut(comp, W, axis, lo, hi) {
  const counts = new Map();
  for (const p of comp.pixels) {
    const x = p % W,
      y = (p - x) / W;
    const k = axis === "y" ? y : x;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const mid = (lo + hi) / 2;
  let best = Math.round(mid),
    bestCount = Infinity;
  for (let k = Math.round(lo); k <= Math.round(hi); k++) {
    const c = counts.get(k) || 0;
    if (c < bestCount || (c === bestCount && Math.abs(k - mid) < Math.abs(best - mid))) {
      bestCount = c;
      best = k;
    }
  }
  return best;
}

/**
 * 把连通域归属到 id（格序号 = 行 * cols + 列）。
 * 阶段 1 全局贪心一一配对；阶段 2 没分到精灵的格说明与邻居粘连，按最小割切开。
 */
export function claimsFor(comps, cols, rows, count, W, H, report = { splits: [], splitComps: new Set() }) {
  const cellW = W / cols,
    cellH = H / rows;
  const cellOf = (x, y) =>
    Math.min(rows - 1, Math.floor(y / cellH)) * cols +
    Math.min(cols - 1, Math.floor(x / cellW));
  const centerOf = (ci) => ({
    x: ((ci % cols) + 0.5) * cellW,
    y: (Math.floor(ci / cols) + 0.5) * cellH,
  });
  const claims = Array.from({ length: count }, () => []);
  const cellStats = comps.map((comp) => {
    const counts = new Map();
    for (const p of comp.pixels) {
      const x = p % W,
        y = (p - x) / W;
      const ci = cellOf(x, y);
      counts.set(ci, (counts.get(ci) || 0) + 1);
    }
    return [...counts].filter(([ci]) => ci < count).sort((a, b) => b[1] - a[1]);
  });

  const pairs = [];
  cellStats.forEach((list, comp) => list.forEach(([ci, n]) => pairs.push({ comp, ci, n })));
  pairs.sort((a, b) => b.n - a.n);
  const compOwner = new Map(),
    cellOwner = new Map();
  for (const { comp, ci } of pairs) {
    if (compOwner.has(comp) || cellOwner.has(ci)) continue;
    compOwner.set(comp, ci);
    cellOwner.set(ci, comp);
  }
  for (const [comp, ci] of compOwner) claims[ci].push(...comps[comp].pixels);

  for (let ci = 0; ci < count; ci++) {
    if (cellOwner.has(ci)) continue;
    let best = null;
    cellStats.forEach((list, comp) => {
      const hit = list.find(([c]) => c === ci);
      if (hit && (!best || hit[1] > best.n)) best = { comp, n: hit[1] };
    });
    if (!best || best.n < comps[best.comp].area * CLAIM_SHARE) continue;
    const comp = comps[best.comp];
    const ownerCell = compOwner.get(best.comp);
    if (ownerCell === undefined || report.splitComps.has(best.comp)) continue;
    const a = centerOf(ownerCell),
      b = centerOf(ci);
    const sameRow = Math.floor(ownerCell / cols) === Math.floor(ci / cols);
    const axis = sameRow ? "x" : "y";
    const cut = minCut(comp, W, axis, Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis]));
    const side = [[], []];
    for (const p of comp.pixels) {
      const x = p % W,
        y = (p - x) / W;
      side[(axis === "y" ? y : x) < cut ? 0 : 1].push(p);
    }
    const ownerIsLower = a[axis] > b[axis];
    claims[ownerCell] = ownerIsLower ? side[1] : side[0];
    claims[ci] = ownerIsLower ? side[0] : side[1];
    cellOwner.set(ci, best.comp);
    report.splitComps.add(best.comp);
    report.splits.push(
      `粘连拆分：格#${ownerCell} 与 格#${ci} 共用连通域（${comp.maxX - comp.minX + 1}×${comp.maxY - comp.minY + 1}），沿 ${axis}=${cut} 切开`,
    );
  }
  return { claims, compOwner, cellOwner, cellW, cellH, smooth };
}
