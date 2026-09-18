import { defineStore, getActivePinia } from "pinia";
import { api, setUnauthorizedHandler, type AuthUser } from "./api";

export const useAuth = defineStore("auth", {
  state: () => ({
    user: null as AuthUser | null,
    busy: false,
    error: "",
  }),
  getters: {
    loggedIn: (state) => state.user !== null,
  },
  actions: {
    async refresh() {
      try {
        const { user } = await api.me();
        this.user = user;
      } catch {
        this.user = null;
      }
    },
    async login(username: string, password: string) {
      this.busy = true;
      this.error = "";
      try {
        const { user } = await api.login(username, password);
        this.user = user;
        return true;
      } catch (error) {
        this.error = (error as Error).message;
        return false;
      } finally {
        this.busy = false;
      }
    },
    async register(username: string, password: string) {
      this.busy = true;
      this.error = "";
      try {
        const { user } = await api.register(username, password);
        this.user = user;
        return true;
      } catch (error) {
        this.error = (error as Error).message;
        return false;
      } finally {
        this.busy = false;
      }
    },
    async logout() {
      try {
        await api.logout();
      } catch {
        // 网络失败也要允许退出本地登录态
      }
      this.user = null;
      this.error = "";
    },
  },
});

// 任何接口返回 401 都视为会话失效：清掉本地登录态，让 UI 回到未登录。
setUnauthorizedHandler(() => {
  if (!getActivePinia()) return;
  const auth = useAuth();
  if (auth.user) auth.user = null;
});
