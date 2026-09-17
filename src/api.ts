export type AuthUser = { id: string; name: string; createdAt: number };
export type CloudSave = { updatedAt: number; data: unknown };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };
  const response = await fetch(path, { credentials: "include", ...options, headers });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "网络请求失败";
    throw new ApiError(response.status, message);
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
  putSave: (data: unknown) =>
    request<{ updatedAt: number }>("/api/save", {
      method: "PUT",
      body: JSON.stringify({ data }),
    }),
};
