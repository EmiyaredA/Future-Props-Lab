import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

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
