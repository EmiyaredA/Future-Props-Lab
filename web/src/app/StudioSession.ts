import { createContext, useContext } from "react";
import { getCsrfToken } from "@platform/api/studioAuth";

export type SessionUser = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  is_platform_admin: boolean;
  revision: number;
};

export type SessionWorkspace = {
  id: string;
  name: string;
  visibility: "private" | "public";
  revision: number;
  access_kind: "owner" | "member" | "platform_admin" | "public_viewer";
  role: "owner" | "member" | null;
};

export type AuthMe = {
  user: SessionUser;
  workspace: SessionWorkspace;
  must_change_password: boolean;
  session_expires_at: string | null;
};

export type SessionContextValue = {
  me: AuthMe;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
};

export const SessionContext = createContext<SessionContextValue | null>(null);

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const problem = payload as Record<string, unknown>;
  const detail = problem.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const nested = detail as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
    if (typeof nested.code === "string") return nested.code;
  }
  return typeof problem.message === "string" ? problem.message : fallback;
}

export async function sessionRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const method = String(init.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const base = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(errorMessage(problem, "请求失败，请稍后重试"));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function useStudioSession() {
  const value = useContext(SessionContext);
  if (!value)
    throw new Error("useStudioSession must be used inside StudioAuthGate");
  return value;
}

export function useOptionalStudioSession() {
  return useContext(SessionContext);
}
