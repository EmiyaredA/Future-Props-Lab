import type { components } from "@generated/api";
import { api, unwrap, fetchApiBlob } from "@platform/api/client";

export type Table = components["schemas"]["TableSpec"];
export type Field = components["schemas"]["FieldSpec"];
export type View = components["schemas"]["ViewSpec"];
export type Config = components["schemas"]["ViewConfig"];
export type RecordRow = components["schemas"]["RecordSpec"];
export type Structure = components["schemas"]["Structure"];
export type Query = components["schemas"]["QueryIn"];
export type Operation = components["schemas"]["BatchIn"]["operations"][number];
export type Scope = { publication?: string; parent?: string };
export const tableStructure = async (
  note_id: string,
  scope: Scope,
  signal?: AbortSignal,
) =>
  scope.publication
    ? unwrap(
        await api.GET(
          "/v1/thought-workshop/community/publications/{publication_id}/notes/{note_id}/multitable",
          {
            params: {
              path: { publication_id: scope.publication, note_id },
              query: { parent_note_id: scope.parent },
            },
            signal,
          },
        ),
      )
    : unwrap(
        await api.GET("/v1/thought-workshop/notes/{note_id}/multitable", {
          params: { path: { note_id } },
          signal,
        }),
      );
export const tableRecords = async (
  note_id: string,
  table_id: string,
  body: Query,
  scope: Scope,
  signal?: AbortSignal,
) =>
  scope.publication
    ? unwrap(
        await api.POST(
          "/v1/thought-workshop/community/publications/{publication_id}/notes/{note_id}/multitable/tables/{table_id}/query",
          {
            params: {
              path: { publication_id: scope.publication, note_id, table_id },
              query: { parent_note_id: scope.parent },
            },
            body,
            signal,
          },
        ),
      )
    : unwrap(
        await api.POST(
          "/v1/thought-workshop/notes/{note_id}/multitable/tables/{table_id}/query",
          { params: { path: { note_id, table_id } }, body, signal },
        ),
      );
export const tableOperations = async (
  note_id: string,
  expected_revision: number,
  operations: Operation[],
  scope: Scope,
) =>
  scope.publication
    ? unwrap(
        await api.POST(
          "/v1/thought-workshop/community/publications/{publication_id}/notes/{note_id}/multitable/operations",
          {
            params: {
              path: { publication_id: scope.publication, note_id },
              query: { parent_note_id: scope.parent },
            },
            body: { expected_revision, operations },
          },
        ),
      )
    : unwrap(
        await api.POST(
          "/v1/thought-workshop/notes/{note_id}/multitable/operations",
          {
            params: { path: { note_id } },
            body: { expected_revision, operations },
          },
        ),
      );
export const conversionPreview = async (
  note_id: string,
  table: Table,
  scope: Scope = {},
) =>
  scope.publication
    ? unwrap(
        await api.POST(
          "/v1/thought-workshop/community/publications/{publication_id}/notes/{note_id}/multitable/conversion-preview",
          {
            params: {
              path: { publication_id: scope.publication, note_id },
              query: { parent_note_id: scope.parent },
            },
            body: { table },
          },
        ),
      )
    : unwrap(
        await api.POST(
          "/v1/thought-workshop/notes/{note_id}/multitable/conversion-preview",
          { params: { path: { note_id } }, body: { table } },
        ),
      );
export const csvPreview = async (
  note_id: string,
  csv: string,
  header: boolean,
  table?: Table,
  mapping?: (string | null)[],
) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/notes/{note_id}/multitable/csv-preview",
      { params: { path: { note_id } }, body: { csv, header, table, mapping } },
    ),
  );
export const csvImport = async (
  note_id: string,
  table_id: string,
  body: components["schemas"]["CsvIn"],
) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/notes/{note_id}/multitable/tables/{table_id}/csv-import",
      { params: { path: { note_id, table_id } }, body },
    ),
  );
export const csvExport = async (
  note_id: string,
  table_id: string,
  body: Query,
) => {
  const response = await api.POST(
    "/v1/thought-workshop/notes/{note_id}/multitable/tables/{table_id}/csv-export",
    { params: { path: { note_id, table_id } }, body, parseAs: "blob" },
  );
  return unwrap(response);
};
export const tableHistory = async (note_id: string, offset = 0) =>
  unwrap(
    await api.GET("/v1/thought-workshop/notes/{note_id}/multitable/history", {
      params: { path: { note_id }, query: { offset } },
    }),
  );
export const historySnapshot = async (note_id: string, revision: number) =>
  unwrap(
    await api.GET(
      "/v1/thought-workshop/notes/{note_id}/multitable/history/{revision}",
      { params: { path: { note_id, revision } } },
    ),
  );
export const restoreTable = async (
  note_id: string,
  revision: number,
  expected_revision: number,
) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/notes/{note_id}/multitable/history/{revision}/restore",
      { params: { path: { note_id, revision } }, body: { expected_revision } },
    ),
  );
export { fetchApiBlob };
