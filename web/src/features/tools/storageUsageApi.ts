import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type StorageUsageState = components["schemas"]["StorageUsageState"];

export async function getStorageUsage(directory?: string) {
  return unwrap(
    await api.GET("/v1/tool-navigation/storage-usage", {
      params: { query: { directory } },
    }),
  );
}

export async function openStorageDirectory(
  directory: string,
  analyze: boolean,
) {
  return unwrap(
    await api.POST(
      analyze
        ? "/v1/tool-navigation/storage-usage/analyze"
        : "/v1/tool-navigation/storage-usage/open-directory",
      { body: { directory } },
    ),
  );
}
