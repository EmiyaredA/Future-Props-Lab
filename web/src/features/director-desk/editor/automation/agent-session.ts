import { ApiError, fetchApiJson } from "@platform/api/client";

import { TOOL_DEFINITIONS } from "./contract.ts";

type PendingCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  request_id: string;
};

/** Keep the open editor as the only scene writer for external tool calls. */
export function attachDirectorAgentSession(
  projectId: string,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): () => void {
  const abort = new AbortController();
  let stopped = false;
  let sessionId = "";
  const root = `/v1/director-desk/projects/${encodeURIComponent(projectId)}/agent-session`;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, ms);
      abort.signal.addEventListener("abort", () => {
        window.clearTimeout(timer);
        resolve();
      });
    });

  const run = async () => {
    while (!stopped) {
      try {
        if (!sessionId) {
          const claimed = await fetchApiJson<{ session_id: string }>(root, {
            method: "POST",
            signal: abort.signal,
          });
          sessionId = claimed.session_id;
        }
        const polled = await fetchApiJson<{ call: PendingCall | null }>(
          `${root}/calls?session_id=${encodeURIComponent(sessionId)}&wait=20`,
          { signal: abort.signal },
        );
        if (!polled.call || stopped) continue;
        const call = polled.call;
        let body: { session_id: string; result?: unknown; error?: string };
        try {
          const outcome = await callTool(call.name, withRequestId(call));
          body = toolBody(sessionId, outcome);
        } catch (error) {
          body = {
            session_id: sessionId,
            error: error instanceof Error ? error.message : "工具执行失败",
          };
        }
        if (stopped) return;
        await fetchApiJson(`${root}/calls/${encodeURIComponent(call.id)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: abort.signal,
        });
      } catch (error) {
        if (stopped || abort.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) return;
        sessionId = "";
        await sleep(1000);
      }
    }
  };

  void run();
  return () => {
    stopped = true;
    abort.abort();
    if (!sessionId) return;
    void fetchApiJson(`${root}?session_id=${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }).catch(() => undefined);
  };
}

function withRequestId(call: PendingCall): Record<string, unknown> {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === call.name);
  const properties = (
    definition?.inputSchema as
      { properties?: Record<string, unknown> } | undefined
  )?.properties;
  if (!properties || !Object.hasOwn(properties, "requestId"))
    return call.arguments;
  return { ...call.arguments, requestId: call.request_id };
}

function toolBody(sessionId: string, outcome: unknown) {
  if (outcome && typeof outcome === "object" && "ok" in outcome) {
    const wrapped = outcome as { ok: boolean; data?: unknown; error?: string };
    if (!wrapped.ok) {
      return { session_id: sessionId, error: wrapped.error || "工具执行失败" };
    }
    return { session_id: sessionId, result: wrapped.data ?? null };
  }
  return { session_id: sessionId, result: outcome };
}
