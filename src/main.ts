import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./style.css";
// 启动时打印版本：支持排查时先问「控制台第一行的版本号」。
console.info(`庭院保卫战 ${__APP_VERSION__} (build ${__BUILD_ID__})`);
createApp(App).use(createPinia()).mount("#app");
