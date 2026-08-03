import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
import { ApiError } from "@platform/api/client";
import { getStudioToken, notifyAuthRequired } from "@platform/api/studioAuth";

export type Catalog = components["schemas"]["ModelCatalogOut"];
export type Provider = components["schemas"]["ProviderOut"];
export type ProviderInput = Omit<
  components["schemas"]["ProviderIn"],
  "expected_catalog_revision"
>;
export type ModelEntry = components["schemas"]["ModelEntryOut"];
export type ModelInput = Omit<
  components["schemas"]["ModelEntryIn"],
  "expected_catalog_revision"
>;
export type TestResult = components["schemas"]["TestModelOut"];
export type CallLog = components["schemas"]["CallLogOut"];
export type CallLogItem = components["schemas"]["CallLogListItem"];
export type CallLogList = components["schemas"]["CallLogListOut"];
export type CallLogStats = components["schemas"]["CallLogStatsOut"];
export type ModelTestConversation =
  components["schemas"]["ModelTestConversationOut"];
export type ModelTestConversationSummary =
  components["schemas"]["ModelTestConversationSummaryOut"];
export type ModelTestMessage = components["schemas"]["ModelTestMessageOut"];

export async function getCatalog(): Promise<Catalog> {
  return unwrap(await api.GET("/v1/model-providers"));
}

export async function createProvider(body: ProviderInput, revision: number) {
  return unwrap(
    await api.POST("/v1/model-providers", {
      body: { ...body, expected_catalog_revision: revision },
    }),
  );
}

export async function updateProvider(
  id: string,
  body: ProviderInput,
  revision: number,
) {
  return unwrap(
    await api.PATCH("/v1/model-providers/{provider_id}", {
      params: { path: { provider_id: id } },
      body: { ...body, expected_catalog_revision: revision },
    }),
  );
}

export async function setProviderEnabled(
  id: string,
  enabled: boolean,
  revision: number,
) {
  return unwrap(
    await api.POST("/v1/model-providers/{provider_id}/enabled", {
      params: { path: { provider_id: id } },
      body: { enabled, expected_catalog_revision: revision },
    }),
  );
}

export async function deleteProvider(id: string, revision: number) {
  return unwrap(
    await api.DELETE("/v1/model-providers/{provider_id}", {
      params: {
        path: { provider_id: id },
        query: { expected_catalog_revision: revision },
      },
    }),
  );
}

export async function addModel(
  providerId: string,
  body: ModelInput,
  revision: number,
) {
  return unwrap(
    await api.POST("/v1/model-providers/{provider_id}/models", {
      params: { path: { provider_id: providerId } },
      body: { ...body, expected_catalog_revision: revision },
    }),
  );
}

export async function updateModel(
  id: string,
  body: ModelInput,
  revision: number,
) {
  return unwrap(
    await api.PATCH("/v1/model-entries/{model_id}", {
      params: { path: { model_id: id } },
      body: { ...body, expected_catalog_revision: revision },
    }),
  );
}

export async function deleteModel(id: string, revision: number) {
  return unwrap(
    await api.DELETE("/v1/model-entries/{model_id}", {
      params: {
        path: { model_id: id },
        query: { expected_catalog_revision: revision },
      },
    }),
  );
}

export async function testModel(id: string): Promise<TestResult> {
  return unwrap(
    await api.POST("/v1/model-entries/{model_id}/test", {
      params: { path: { model_id: id } },
    }),
  );
}

export type LogFilters = {
  q: string;
  callSource: string;
  providerKind: string;
  model: string;
  status: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
};

export async function getLogs(filters: LogFilters): Promise<CallLogList> {
  return unwrap(
    await api.GET("/v1/llm-call-logs", {
      params: {
        query: {
          q: filters.q || undefined,
          call_source: filters.callSource || undefined,
          provider_kind: filters.providerKind || undefined,
          model: filters.model || undefined,
          status: filters.status || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          page: filters.page,
          page_size: filters.pageSize,
        },
      },
    }),
  );
}

export async function getLogStats(): Promise<CallLogStats> {
  return unwrap(await api.GET("/v1/llm-call-logs/stats"));
}

export async function getLog(id: string): Promise<CallLog> {
  return unwrap(
    await api.GET("/v1/llm-call-logs/{log_id}", {
      params: { path: { log_id: id } },
    }),
  );
}

export async function deleteLog(id: string) {
  return unwrap(
    await api.DELETE("/v1/llm-call-logs/{log_id}", {
      params: { path: { log_id: id } },
    }),
  );
}

export async function batchDeleteLogs(ids: string[]) {
  return unwrap(
    await api.POST("/v1/llm-call-logs/batch-delete", { body: { ids } }),
  );
}

export async function getModelTestConversations() {
  return unwrap(await api.GET("/v1/model-test/conversations"));
}

export async function createModelTestConversation(modelId?: string) {
  return unwrap(
    await api.POST("/v1/model-test/conversations", {
      body: { model_id: modelId ?? null },
    }),
  );
}

export async function getModelTestConversation(id: string) {
  return unwrap(
    await api.GET("/v1/model-test/conversations/{conversation_id}", {
      params: { path: { conversation_id: id } },
    }),
  );
}

export async function patchModelTestConversation(
  id: string,
  revision: number,
  changes: Partial<
    Pick<
      ModelTestConversation,
      "title" | "model_id" | "system_prompt" | "temperature" | "max_tokens"
    >
  >,
) {
  return unwrap(
    await api.PATCH("/v1/model-test/conversations/{conversation_id}", {
      params: { path: { conversation_id: id } },
      body: { ...changes, expected_revision: revision },
    }),
  );
}

export async function deleteModelTestConversation(
  id: string,
  revision: number,
) {
  return unwrap(
    await api.DELETE("/v1/model-test/conversations/{conversation_id}", {
      params: {
        path: { conversation_id: id },
        query: { expected_revision: revision },
      },
    }),
  );
}

export type ModelStreamEvent = {
  type: "start" | "delta" | "done" | "error";
  schema_version: 2;
  sequence: number;
  payload: Record<string, unknown>;
};

export async function streamModelTest(
  id: string,
  body: { expected_revision: number; content?: string },
  regenerate: boolean,
  signal: AbortSignal,
  onEvent: (event: ModelStreamEvent) => void,
) {
  const base = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  const suffix = regenerate ? "regenerate/stream" : "messages/stream";
  const token = getStudioToken();
  const response = await fetch(
    `${base}/v1/model-test/conversations/${encodeURIComponent(id)}/${suffix}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { "X-Studio-Token": token } : {}),
      },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (response.status === 401) notifyAuthRequired();
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    throw new ApiError(
      String(problem.detail || "请求失败，请稍后重试"),
      problem,
      response.status,
    );
  }
  if (!response.body) throw new Error("浏览器不支持流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (data) onEvent(JSON.parse(data) as ModelStreamEvent);
    }
    if (done) break;
  }
}
