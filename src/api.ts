export type AuthUser = { id: string; name: string; createdAt: number };
export type CloudSave = { updatedAt: number; data: unknown };

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

/** 401 的集中处理：由 auth store 注册，避免各调用点各自为战。 */
let unauthorizedHandler: (() => void) | undefined;
export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

const DEFAULT_TIMEOUT_MS = 12000;

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError")
      throw new ApiError(0, "请求超时，请检查网络后重试");
    throw new ApiError(0, "网络请求失败");
  } finally {
    clearTimeout(timer);
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "网络请求失败";
    throw new ApiError(response.status, message, payload);
  }
  return payload as T;
}

export const api = {
  me: () => request<{ user: AuthUser }>("/api/me"),
  register: (username: string, password: string) =>
    request<{ user: AuthUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  getSave: () => request<{ save: CloudSave | null }>("/api/save"),
  putSave: (data: unknown, baseUpdatedAt?: number) =>
    request<{ updatedAt: number }>("/api/save", {
      method: "PUT",
      body: JSON.stringify({ data, baseUpdatedAt }),
    }),
};
