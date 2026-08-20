import createClient from "openapi-fetch";
import type { paths } from "@generated/api";
import {
  applySessionHeaders,
  notifyAuthRequired,
  notifyWorkspaceChanged,
} from "@platform/api/studioAuth";
import { ApiError, type ProblemDetail } from "@platform/api/errors";

export { ApiError, type ProblemDetail } from "@platform/api/errors";

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE || "",
  credentials: "include",
});

export async function fetchApiBlob(path: string): Promise<Blob> {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE || ""}${path}`,
    {
      credentials: "include",
    },
  );
  if (response.status === 401) notifyAuthRequired();
  if (!response.ok) {
    let problem: ProblemDetail = {};
    try {
      problem = (await response.json()) as ProblemDetail;
    } catch {
      // Non-JSON file response failures still receive a useful fallback.
    }
    throw new ApiError(
      String(problem.detail || "文件读取失败"),
      problem,
      response.status,
    );
  }
  return response.blob();
}
api.use({
  async onRequest({ request }) {
    return applySessionHeaders(request);
  },
  async onResponse({ response }) {
    if (response.status === 401) notifyAuthRequired();
    if (response.status === 409) {
      const clone = response.clone();
      const problem = (await clone.json().catch(() => ({}))) as ProblemDetail;
      const detail = problem.detail as { code?: string } | undefined;
      if (
        problem.code === "workspace_access_changed" ||
        detail?.code === "workspace_access_changed"
      ) {
        notifyWorkspaceChanged();
      }
    }
    return response;
  },
});

export async function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  const problem = (result.error ?? {}) as ProblemDetail;
  throw new ApiError(
    String(problem.detail || "请求失败，请稍后重试"),
    problem,
    result.response.status,
  );
}
