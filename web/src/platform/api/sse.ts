import { ApiError, type ProblemDetail } from "@platform/api/client";
import { getCsrfToken, notifyAuthRequired } from "@platform/api/studioAuth";

type PostSseOptions<TEvent> = {
  path: string;
  body: unknown;
  signal: AbortSignal;
  onEvent: (event: TEvent) => void;
  defaultErrorMessage: string;
};

function errorMessage(problem: ProblemDetail, fallback: string) {
  const detail = problem.detail as unknown;
  if (typeof detail === "string" && detail) return detail;
  if (detail && typeof detail === "object") {
    const nested = detail as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message)
      return nested.message;
    if (typeof nested.detail === "string" && nested.detail)
      return nested.detail;
  }
  const message = problem.message;
  return typeof message === "string" && message ? message : fallback;
}

function parseFrame<TEvent>(frame: string, onEvent: (event: TEvent) => void) {
  const data = frame
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => (line === "data" ? "" : line.slice(5).replace(/^ /, "")))
    .join("\n");
  if (!data) return;
  try {
    onEvent(JSON.parse(data) as TEvent);
  } catch {
    throw new ApiError(
      "流式响应格式无效",
      { code: "invalid_sse_event", detail: "流式事件不是有效的 JSON" },
      0,
    );
  }
}

export async function postSse<TEvent>({
  path,
  body,
  signal,
  onEvent,
  defaultErrorMessage,
}: PostSseOptions<TEvent>) {
  const base = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  const csrf = getCsrfToken();
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 401) notifyAuthRequired();
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as ProblemDetail;
    throw new ApiError(
      errorMessage(problem, defaultErrorMessage),
      problem,
      response.status,
    );
  }
  if (!response.body) {
    throw new ApiError(
      "浏览器不支持流式响应",
      { code: "stream_unavailable", detail: "响应没有可读取的数据流" },
      0,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    frames.forEach((frame) => parseFrame(frame, onEvent));
    if (done) break;
  }
  if (buffer.trim()) parseFrame(buffer, onEvent);
}
