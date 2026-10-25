import { api, unwrap } from "@platform/api/client";
import type { Change, Definition, Example } from "./model";
export const listTemplates = async (signal?: AbortSignal) =>
  unwrap(
    await api.GET("/v1/presentation-workshop/templates", {
      signal,
      params: { query: { limit: 100 } },
    }),
  );
export const listExamples = async (signal?: AbortSignal) =>
  unwrap(
    await api.GET("/v1/presentation-workshop/examples", {
      signal,
      params: { query: { limit: 100 } },
    }),
  );
export const getTemplate = async (id: string) =>
  unwrap(
    await api.GET("/v1/presentation-workshop/templates/{template_id}", {
      params: { path: { template_id: id } },
    }),
  );
export const createTemplate = async (title: string, definition: Definition) =>
  unwrap(
    await api.POST("/v1/presentation-workshop/templates", {
      body: { title, definition, description: "" },
    }),
  );
export const saveTemplate = async (
  id: string,
  title: string,
  definition: Definition,
  revision: number,
) =>
  unwrap(
    await api.PUT("/v1/presentation-workshop/templates/{template_id}", {
      params: { path: { template_id: id } },
      body: { title, definition, description: "", expected_revision: revision },
    }),
  );
export const removeTemplate = async (id: string, revision: number) =>
  unwrap(
    await api.DELETE("/v1/presentation-workshop/templates/{template_id}", {
      params: {
        path: { template_id: id },
        query: { expected_revision: revision },
      },
    }),
  );
export const removeExample = async (id: string, revision: number) =>
  unwrap(
    await api.DELETE("/v1/presentation-workshop/examples/{example_id}", {
      params: {
        path: { example_id: id },
        query: { expected_revision: revision },
      },
    }),
  );
export const createExample = async (
  body: Pick<Example, "title" | "document">,
) =>
  unwrap(
    await api.POST("/v1/presentation-workshop/examples", {
      body: { ...body, description: "" },
    }),
  );
export const fromTemplate = async (
  id: string,
  revision: number,
  title: string,
) =>
  unwrap(
    await api.POST(
      "/v1/presentation-workshop/templates/{template_id}/documents",
      {
        params: { path: { template_id: id } },
        body: { title, expected_revision: revision },
      },
    ),
  );
export const fromExample = async (
  id: string,
  revision: number,
  title: string,
) =>
  unwrap(
    await api.POST(
      "/v1/presentation-workshop/examples/{example_id}/documents",
      {
        params: { path: { example_id: id } },
        body: { title, expected_revision: revision },
      },
    ),
  );
export const previewChange = async (id: string, body: Change) =>
  unwrap(
    await api.POST(
      "/v1/presentation-workshop/projects/{project_id}/template/preview",
      { params: { path: { project_id: id } }, body },
    ),
  );
export const applyChange = async (
  id: string,
  body: Change,
  preview_token: string,
) =>
  unwrap(
    await api.POST(
      "/v1/presentation-workshop/projects/{project_id}/template/apply",
      {
        params: { path: { project_id: id } },
        body: { ...body, preview_token },
      },
    ),
  );

export const importBundle = async (
  body: import("@generated/api").components["schemas"]["TemplateBundleIn"],
) =>
  unwrap(await api.POST("/v1/presentation-workshop/library/import", { body }));
