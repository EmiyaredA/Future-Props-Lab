import createClient from "openapi-fetch";
import type { paths } from "@generated/api";
import { getStudioToken, notifyAuthRequired } from "@platform/api/studioAuth";
import { ApiError, type ProblemDetail } from "@platform/api/errors";

export { ApiError, type ProblemDetail } from "@platform/api/errors";

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE || "",
});

export async function fetchApiBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const token = getStudioToken();
  if (token) headers.set("X-Studio-Token", token);
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE || ""}${path}`,
    {
      headers,
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
    const token = getStudioToken();
    if (token) request.headers.set("X-Studio-Token", token);
    return request;
  },
  async onResponse({ response }) {
    if (response.status === 401) notifyAuthRequired();
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
