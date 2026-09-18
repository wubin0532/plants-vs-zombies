/// <reference types="vite/client" />

/** 由 vite.config.ts 的 define 注入；每次构建不同，用于素材 URL 的缓存失效。 */
declare const __BUILD_ID__: string;
