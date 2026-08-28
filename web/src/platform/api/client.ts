import createClient from "openapi-fetch";
import type { paths } from "@generated/api";
import {
  applySessionHeaders,
  notifyAuthRequired,
  notifyWorkspaceChanged,
} from "@platform/api/studioAuth";
import {
  ApiError,
  parseProblemDetail,
  problemDetailMessage,
  type ProblemDetail,
} from "@platform/api/errors";

export { ApiError, type ProblemDetail } from "@platform/api/errors";

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE || "",
  credentials: "include",
});

function apiUrl(path: string): string {
  const base = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base
    ? `${base}${normalized}`
    : new URL(normalized, window.location.origin).toString();
}

async function responseProblem(response: Response): Promise<ProblemDetail> {
  try {
    return parseProblemDetail(await response.json());
  } catch {
    return {};
  }
}

function isWorkspaceChanged(problem: ProblemDetail): boolean {
  const detail = problem.detail as { code?: string } | string | undefined;
  return (
    problem.code === "workspace_access_changed" ||
    (typeof detail === "object" && detail?.code === "workspace_access_changed")
  );
}

export async function requestApi(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { signal, ...requestInit } = init;
  const request = applySessionHeaders(
    new Request(apiUrl(path), { ...requestInit, credentials: "include" }),
  );
  const response = signal
    ? await fetch(request, { signal })
    : await fetch(request);
  if (response.status === 401) notifyAuthRequired();
  if (!response.ok) {
    const problem = await responseProblem(response);
    if (response.status === 409 && isWorkspaceChanged(problem))
      notifyWorkspaceChanged();
    throw new ApiError(problemDetailMessage(problem), problem, response.status);
  }
  return response;
}

export async function fetchApiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await requestApi(path, init);
  return (await response.json()) as T;
}

export async function fetchApiBlob(
  path: string,
  init: RequestInit = {},
): Promise<Blob> {
  const response = await requestApi(path, init);
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
      const problem = parseProblemDetail(await clone.json().catch(() => ({})));
      if (isWorkspaceChanged(problem)) notifyWorkspaceChanged();
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
  const problem = parseProblemDetail(result.error);
  throw new ApiError(
    problemDetailMessage(problem),
    problem,
    result.response.status,
  );
}
