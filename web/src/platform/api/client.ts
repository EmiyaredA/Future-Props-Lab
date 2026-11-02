import {
  addApplicationBuild,
  observeApplicationBuild,
} from "./applicationBuild";
import createClient from "openapi-fetch";
import type { paths } from "@generated/api";
import {
  applySessionHeaders,
  notifyAuthRequired,
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

export async function requestApi(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { signal, ...requestInit } = init;
  const request = addApplicationBuild(
    applySessionHeaders(
      new Request(apiUrl(path), { ...requestInit, credentials: "include" }),
    ),
  );
  const response = signal
    ? await fetch(request, { signal })
    : await fetch(request);
  observeApplicationBuild(response);
  if (response.status === 401) notifyAuthRequired();
  if (!response.ok) {
    const problem = await responseProblem(response);
    if (
      response.status === 403 &&
      ["insufficient_permission", "insufficient_scope"].includes(
        String(problem.code),
      )
    )
      window.dispatchEvent(new Event("future-props:permissions-changed"));
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

export type ApiDownload = {
  blob: Blob;
  filename: string | null;
};

export function filenameFromContentDisposition(
  value: string | null,
): string | null {
  if (!value) return null;
  const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim()).replace(/[\\/]/g, "_");
    } catch {
      // Fall through to the quoted/plain filename form.
    }
  }
  const plain = value.match(/filename\s*=\s*(?:"((?:\\.|[^"])*)"|([^;]+))/i);
  const filename = (plain?.[1] ?? plain?.[2])?.trim().replace(/\\"/g, '"');
  return filename ? filename.replace(/[\\/]/g, "_") : null;
}

export async function fetchApiDownload(
  path: string,
  init: RequestInit = {},
): Promise<ApiDownload> {
  const response = await requestApi(path, init);
  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(
      response.headers.get("Content-Disposition"),
    ),
  };
}
api.use({
  async onRequest({ request }) {
    return addApplicationBuild(applySessionHeaders(request));
  },
  async onResponse({ response }) {
    observeApplicationBuild(response);
    if (response.status === 401) notifyAuthRequired();
    if (response.status === 403) {
      const problem = parseProblemDetail(
        await response
          .clone()
          .json()
          .catch(() => ({})),
      );
      if (
        ["insufficient_permission", "insufficient_scope"].includes(
          String(problem.code),
        )
      )
        window.dispatchEvent(new Event("future-props:permissions-changed"));
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
  if (result.response.status === 204 && result.response.ok)
    return undefined as T;
  const problem = parseProblemDetail(result.error);
  throw new ApiError(
    problemDetailMessage(problem),
    problem,
    result.response.status,
  );
}
