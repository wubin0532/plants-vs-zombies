import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import pkg from "./package.json";
import { formatVersion } from "./src/version";
// 构建版本号：每次构建都不同，注入到素材 URL 的 ?v=，让更新后浏览器立即取新文件
// （固定文件名的素材此前被 max-age=3600 命中，必须手动清缓存）。
const BUILD_ID = Date.now().toString(36);
// 产品版本号：唯一来源是 package.json，展示串由 src/version.ts 生成（1.0.0 → V1.0）。
const APP_VERSION = formatVersion(pkg.version);
export default defineConfig({
  plugins: [
    vue(),
    {
      // 把 index.html 里的 %APP_VERSION% 换成展示串：部署脚本与支持排查可直接读 meta。
      name: "inject-app-version",
      transformIndexHtml: (html: string) =>
        html.replaceAll("%APP_VERSION%", APP_VERSION),
    },
  ],
  base: "./",
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: {
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
  },
});
