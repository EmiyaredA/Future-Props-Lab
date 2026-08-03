import createClient from "openapi-fetch";
import type { paths } from "@generated/api";
import { getStudioToken, notifyAuthRequired } from "@platform/api/studioAuth";

export type ProblemDetail = {
  code?: string;
  detail?: string;
  status?: number;
  current?: unknown;
  log_id?: string;
  [key: string]: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly problem: ProblemDetail,
    public readonly status: number,
  ) {
    super(message);
  }
}

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE || "",
});
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
