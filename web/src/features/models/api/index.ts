import type { components } from "@generated/api";
import { api, fetchApiBlob, unwrap } from "@platform/api/client";
import { ApiError } from "@platform/api/client";
import { getCsrfToken, notifyAuthRequired } from "@platform/api/studioAuth";
import { postSse } from "@platform/api/sse";

export type Catalog = components["schemas"]["ModelCatalogOut"];
export type Provider = components["schemas"]["ProviderOut"];
export type ProviderInput = Omit<
  components["schemas"]["ProviderIn"],
  "expected_catalog_revision"
>;
export type ModelEntry = components["schemas"]["ModelEntryOut"];
export type ModelCategory = components["schemas"]["ModelCategoryOut"];
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
export type ModelTestAttachment =
  components["schemas"]["ModelTestAttachmentOut"];
export type ModelTestGenerationTask =
  components["schemas"]["ModelTestGenerationTaskOut"];
export type ModelTestGenerationOption =
  components["schemas"]["ModelTestGenerationOptionOut"];
export type ModelTestReferenceAsset =
  components["schemas"]["ModelTestGenerationAssetOut"];
export type ModelTestImageGenerationInput =
  components["schemas"]["ModelTestImageGenerationIn"];
export type ModelTestVideoGenerationInput =
  components["schemas"]["ModelTestVideoGenerationIn"];
export type ModelTestGenerationInput =
  ModelTestImageGenerationInput | ModelTestVideoGenerationInput;

export async function getCatalog(): Promise<Catalog> {
  return unwrap(await api.GET("/v1/model-providers"));
}

export async function getModelCategories() {
  return unwrap(await api.GET("/v1/model-categories"));
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

export async function uploadModelTestAttachments(id: string, files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const base = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  const csrf = getCsrfToken();
  const response = await fetch(
    `${base}/v1/model-test/conversations/${encodeURIComponent(id)}/attachments`,
    {
      method: "POST",
      headers: csrf ? { "X-CSRF-Token": csrf } : {},
      credentials: "include",
      body: form,
    },
  );
  if (response.status === 401) notifyAuthRequired();
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    throw new ApiError(
      String(problem.detail || "图片上传失败"),
      problem,
      response.status,
    );
  }
  return (await response.json()) as components["schemas"]["ModelTestAttachmentListOut"];
}

export async function deleteModelTestAttachment(
  conversationId: string,
  attachmentId: string,
) {
  return unwrap(
    await api.DELETE(
      "/v1/model-test/conversations/{conversation_id}/attachments/{attachment_id}",
      {
        params: {
          path: {
            conversation_id: conversationId,
            attachment_id: attachmentId,
          },
        },
      },
    ),
  );
}

export async function getModelTestGenerationTasks(modelId?: string) {
  return unwrap(
    await api.GET("/v1/model-test/generation-tasks", {
      params: {
        query: { model_id: modelId, page: 1, page_size: 100 },
      },
    }),
  );
}

export async function getModelTestGenerationOptions() {
  return unwrap(await api.GET("/v1/model-test/generation-options"));
}

export async function createModelTestGenerationTask(
  body: ModelTestGenerationInput,
) {
  return unwrap(await api.POST("/v1/model-test/generation-tasks", { body }));
}

export async function uploadModelTestReferenceAssets(files: File[]) {
  return unwrap(
    await api.POST("/v1/model-test/generation-assets", {
      body: { files: files as unknown as string[] },
      bodySerializer() {
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        return form;
      },
    }),
  );
}

export async function deleteModelTestReferenceAsset(
  asset: ModelTestReferenceAsset,
) {
  return unwrap(
    await api.DELETE("/v1/model-test/generation-assets/{asset_id}", {
      params: { path: { asset_id: asset.id } },
    }),
  );
}

export async function cleanupModelTestReferenceAssets() {
  return unwrap(await api.POST("/v1/model-test/generation-assets/cleanup"));
}

export async function getModelTestReferenceBackfillStatus() {
  return unwrap(
    await api.GET("/v1/model-test/generation-assets/backfill-status"),
  );
}

export async function backfillModelTestReferenceAssets() {
  return unwrap(
    await api.POST("/v1/model-test/generation-assets/backfill", {
      params: { query: { limit: 50 } },
    }),
  );
}

export async function deleteModelTestGenerationTask(
  id: string,
  revision: number,
) {
  return unwrap(
    await api.DELETE("/v1/model-test/generation-tasks/{task_id}", {
      params: {
        path: { task_id: id },
        query: { expected_revision: revision },
      },
    }),
  );
}

export async function retryModelTestGenerationMaterialization(id: string) {
  return unwrap(
    await api.POST(
      "/v1/model-test/generation-tasks/{task_id}/retry-materialization",
      { params: { path: { task_id: id } } },
    ),
  );
}

export async function getModelTestGenerationResult(id: string) {
  return fetchApiBlob(
    `/v1/model-test/generation-tasks/${encodeURIComponent(id)}/content`,
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
  body: {
    expected_revision: number;
    content?: string;
    attachment_ids?: string[];
  },
  regenerate: boolean,
  signal: AbortSignal,
  onEvent: (event: ModelStreamEvent) => void,
) {
  const suffix = regenerate ? "regenerate/stream" : "messages/stream";
  await postSse<ModelStreamEvent>({
    path: `/v1/model-test/conversations/${encodeURIComponent(id)}/${suffix}`,
    body,
    signal,
    onEvent,
    defaultErrorMessage: "请求失败，请稍后重试",
  });
}
