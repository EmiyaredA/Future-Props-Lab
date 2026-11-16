import { api, unwrap, requestApi } from "@platform/api/client";
import type { components } from "@generated/api";

export type Project = components["schemas"]["SpreadsheetProject"];
export type Summary = components["schemas"]["SpreadsheetSummary"];
export type Document = components["schemas"]["SpreadsheetDocument"];
export type Preview = components["schemas"]["SpreadsheetImportPreview"];
export type ExportOptions = components["schemas"]["SpreadsheetExport"];
export type Save = components["schemas"]["SpreadsheetPut"];
const root = "/v1/spreadsheet-workshop";

export const spreadsheetKeys = {
  all: (owner: string) => ["spreadsheet", owner] as const,
  list: (owner: string, query: string, offset: number) =>
    ["spreadsheet", owner, "list", query, offset] as const,
  project: (owner: string, id: string) =>
    ["spreadsheet", owner, "project", id] as const,
};

export const booksApi = {
  list: (query: string, offset: number, signal?: AbortSignal) =>
    api
      .GET("/v1/spreadsheet-workshop/projects", {
        params: { query: { query, offset, limit: 30 } },
        signal,
      })
      .then(unwrap),
  get: (project_id: string, signal?: AbortSignal) =>
    api
      .GET("/v1/spreadsheet-workshop/projects/{project_id}", {
        params: { path: { project_id } },
        signal,
      })
      .then(unwrap),
  create: (
    title: string,
    document?: Document,
    request_id = crypto.randomUUID(),
  ) =>
    api
      .POST("/v1/spreadsheet-workshop/projects", {
        body: { title, document, request_id },
      })
      .then(unwrap),
  save: (project_id: string, body: Save) =>
    api
      .PUT("/v1/spreadsheet-workshop/projects/{project_id}", {
        params: { path: { project_id } },
        body,
      })
      .then(unwrap),
  remove: (project_id: string, expected_revision: number, request_id: string) =>
    api
      .DELETE("/v1/spreadsheet-workshop/projects/{project_id}", {
        params: {
          path: { project_id },
          query: { expected_revision, request_id },
        },
      })
      .then(unwrap),
  async preview(
    file: File,
    encoding: "utf-8-sig" | "gb18030",
    signal?: AbortSignal,
  ): Promise<Preview> {
    const body = new FormData();
    body.append("file", file);
    const response = await requestApi(
      root + "/imports/preview?encoding=" + encoding,
      { method: "POST", body, signal },
    );
    return response.json();
  },
  confirm: (import_id: string, preview: Preview, request_id: string) =>
    api
      .POST("/v1/spreadsheet-workshop/imports/{import_id}/confirm", {
        params: { path: { import_id } },
        body: {
          request_id,
          sha256: preview.sha256,
          converter: "spreadsheet-v1",
          accept_warnings: true,
        },
      })
      .then(unwrap),
  async export(project_id: string, body: ExportOptions) {
    const response = await api.POST(
      "/v1/spreadsheet-workshop/projects/{project_id}/export",
      { params: { path: { project_id } }, body, parseAs: "blob" },
    );
    return unwrap(response);
  },
  async original(id: string) {
    return unwrap(
      await api.GET("/v1/spreadsheet-workshop/projects/{project_id}/original", {
        params: { path: { project_id: id } },
        parseAs: "blob",
      }),
    );
  },
};

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
