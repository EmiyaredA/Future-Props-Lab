import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";

export type SearchCriteria = components["schemas"]["SearchCriteria"];
export type Template = components["schemas"]["TemplateOut"];
export type Checkpoint = components["schemas"]["CheckpointOut"];
export type SavedFilter = components["schemas"]["SavedFilterOut"];
export type ReadingPosition = components["schemas"]["ReadingPosition"];
export const globalSearch = async (
  criteria: Partial<SearchCriteria>,
  offset = 0,
  signal?: AbortSignal,
) =>
  unwrap(
    await api.GET("/v1/thought-workshop/search", {
      params: { query: { ...criteria, offset, limit: 40 } },
      signal,
    }),
  );
export const resolveReferences = async (ids: string[], signal?: AbortSignal) =>
  unwrap(
    await api.POST("/v1/thought-workshop/references/resolve", {
      body: { ids },
      signal,
    }),
  );
export const listBacklinks = async (id: string, offset = 0) =>
  unwrap(
    await api.GET("/v1/thought-workshop/notes/{note_id}/backlinks", {
      params: { path: { note_id: id }, query: { offset, limit: 40 } },
    }),
  );
export const listTemplates = async () =>
  unwrap(await api.GET("/v1/thought-workshop/templates"));
export const saveTemplate = async (body: components["schemas"]["TemplateIn"]) =>
  unwrap(await api.POST("/v1/thought-workshop/templates", { body }));
export const updateTemplate = async (
  template: Template,
  patch: Partial<components["schemas"]["TemplateIn"]>,
) =>
  unwrap(
    await api.PUT("/v1/thought-workshop/templates/{template_id}", {
      params: { path: { template_id: template.id } },
      body: {
        name: template.name,
        description: template.description,
        document: template.document,
        tags: template.tags,
        schema_version: template.schema_version,
        kind: template.kind ?? "note",
        multitable: template.multitable,
        ...patch,
        expected_revision: template.revision,
      },
    }),
  );
export const deleteTemplate = async (template: Template) =>
  unwrap(
    await api.DELETE("/v1/thought-workshop/templates/{template_id}", {
      params: {
        path: { template_id: template.id },
        query: { expected_revision: template.revision },
      },
    }),
  );
export const applyTemplate = async (
  template: Template,
  body: Omit<components["schemas"]["TemplateApply"], "expected_revision">,
) =>
  unwrap(
    await api.POST("/v1/thought-workshop/templates/{template_id}/apply", {
      params: { path: { template_id: template.id } },
      body: { ...body, expected_revision: template.revision },
    }),
  );
export const copySnapshot = async (id: string, subtree: boolean) =>
  unwrap(
    await api.GET("/v1/thought-workshop/notes/{note_id}/copy-snapshot", {
      params: { path: { note_id: id }, query: { subtree } },
    }),
  );
export const duplicateDocument = async (
  id: string,
  body: components["schemas"]["DuplicateIn"],
) =>
  unwrap(
    await api.POST("/v1/thought-workshop/notes/{note_id}/duplicate", {
      params: { path: { note_id: id } },
      body,
    }),
  );
export const listCheckpoints = async (id: string) =>
  unwrap(
    await api.GET("/v1/thought-workshop/notes/{note_id}/checkpoints", {
      params: { path: { note_id: id } },
    }),
  );
export const createCheckpoint = async (
  id: string,
  body: components["schemas"]["CheckpointIn"],
) =>
  unwrap(
    await api.POST("/v1/thought-workshop/notes/{note_id}/checkpoints", {
      params: { path: { note_id: id } },
      body,
    }),
  );
export const renameCheckpoint = async (checkpoint: Checkpoint, name: string) =>
  unwrap(
    await api.PUT(
      "/v1/thought-workshop/notes/{note_id}/checkpoints/{checkpoint_id}",
      {
        params: {
          path: { note_id: checkpoint.note_id, checkpoint_id: checkpoint.id },
        },
        body: { name, expected_revision: checkpoint.revision },
      },
    ),
  );
export const deleteCheckpoint = async (checkpoint: Checkpoint) =>
  unwrap(
    await api.DELETE(
      "/v1/thought-workshop/notes/{note_id}/checkpoints/{checkpoint_id}",
      {
        params: {
          path: { note_id: checkpoint.note_id, checkpoint_id: checkpoint.id },
          query: { expected_revision: checkpoint.revision },
        },
      },
    ),
  );
export const listFilters = async () =>
  unwrap(await api.GET("/v1/thought-workshop/preferences/filters"));
export const saveFilter = async (name: string, criteria: SearchCriteria) =>
  unwrap(
    await api.POST("/v1/thought-workshop/preferences/filters", {
      body: { name, criteria },
    }),
  );
export const updateFilter = async (
  filter: SavedFilter,
  name: string,
  criteria = filter.criteria,
) =>
  unwrap(
    await api.PUT("/v1/thought-workshop/preferences/filters/{filter_id}", {
      params: { path: { filter_id: filter.id } },
      body: { name, criteria, expected_revision: filter.revision },
    }),
  );
export const deleteFilter = async (filter: SavedFilter) =>
  unwrap(
    await api.DELETE("/v1/thought-workshop/preferences/filters/{filter_id}", {
      params: {
        path: { filter_id: filter.id },
        query: { expected_revision: filter.revision },
      },
    }),
  );
export const recentDocuments = async () =>
  unwrap(await api.GET("/v1/thought-workshop/preferences/recent"));
export const getReading = async (resource_id: string) =>
  unwrap(
    await api.GET("/v1/thought-workshop/preferences/reading", {
      params: { query: { resource_id } },
    }),
  );
export const recordReading = async (
  resource_id: string,
  title: string,
  position: ReadingPosition,
) =>
  unwrap(
    await api.POST("/v1/thought-workshop/preferences/reading", {
      body: { resource_id, title, position },
    }),
  );
export const libraryExportSnapshot = async (id: string) =>
  unwrap(
    await api.GET(
      "/v1/thought-workshop/knowledge-bases/{project_id}/export-snapshot",
      { params: { path: { project_id: id } } },
    ),
  );
