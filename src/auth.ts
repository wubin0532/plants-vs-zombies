import { defineStore } from "pinia";
import { api, type AuthUser } from "./api";

export const useAuth = defineStore("auth", {
  state: () => ({
    user: null as AuthUser | null,
    ready: false,
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
      } finally {
        this.ready = true;
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
