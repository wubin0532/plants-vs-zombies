/**
 * 源图解析：assets-source 下的素材可能是 png / webp / jpg，
 * 统一按"同名优先 webp"的顺序解析，避免压缩成 webp 后脚本找不到源。
 */
import { existsSync } from "node:fs";

const EXTS = [".webp", ".png", ".jpg", ".jpeg"];

/** 传入不含扩展名的路径，返回实际存在的文件路径；找不到返回 null */
export function sourcePath(base) {
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  return null;
}

export function sourcePathOrThrow(base) {
  const path = sourcePath(base);
  if (!path) throw new Error(`找不到源图：${base}.(webp|png|jpg)`);
  return path;
}

/** 去掉扩展名 */
export const stem = (name) => name.replace(/\.[^.]+$/, "");
