import { api, unwrap } from "@platform/api/client";
const serialize = (body: unknown) => {
  const values = body as { upload: File; allow_lossy?: boolean };
  const form = new FormData();
  form.append("upload", values.upload);
  if (values.allow_lossy !== undefined)
    form.append("allow_lossy", String(values.allow_lossy));
  return form;
};
export const previewImport = async (file: File, signal?: AbortSignal) =>
  unwrap(
    await api.POST("/v1/presentation-workshop/imports/preview", {
      body: { upload: file as unknown as string },
      bodySerializer: serialize,
      signal,
    }),
  );
export const importProject = async (file: File, allowLossy: boolean) =>
  unwrap(
    await api.POST("/v1/presentation-workshop/imports", {
      body: { upload: file as unknown as string, allow_lossy: allowLossy },
      bodySerializer: serialize,
    }),
  );
export const previewExport = async (id: string, revision: number) =>
  unwrap(
    await api.POST(
      "/v1/presentation-workshop/projects/{project_id}/export/preview",
      {
        params: { path: { project_id: id } },
        body: { expected_revision: revision },
      },
    ),
  );
export const exportFile = async (
  id: string,
  revision: number,
  format: "json" | "fplppt",
) =>
  unwrap(
    await api.POST(
      "/v1/presentation-workshop/projects/{project_id}/export/{format}",
      {
        params: { path: { project_id: id, format } },
        body: { expected_revision: revision },
        parseAs: "blob",
      },
    ),
  );
