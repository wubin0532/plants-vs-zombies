import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
// 构建版本号：每次构建都不同，注入到素材 URL 的 ?v=，让更新后浏览器立即取新文件
// （固定文件名的素材此前被 max-age=3600 命中，必须手动清缓存）。
const BUILD_ID = Date.now().toString(36);
export default defineConfig({
  plugins: [vue()],
  base: "./",
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: {
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
  },
});
