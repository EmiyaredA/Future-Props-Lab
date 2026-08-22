import type { components } from "@generated/api";
import { api, fetchApiBlob, unwrap } from "@platform/api/client";

type PreviewIn = components["schemas"]["GalgameVideoExportPreviewIn"];
type CreateIn = components["schemas"]["GalgameVideoExportCreateIn"];

export async function previewGalgameVideoExport(
  projectId: string,
  body: PreviewIn,
) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/video-exports/preview",
      { params: { path: { project_id: projectId } }, body },
    ),
  );
}

export async function createGalgameVideoExport(
  projectId: string,
  body: CreateIn,
) {
  return unwrap(
    await api.POST("/v1/galgame-workshop/projects/{project_id}/video-exports", {
      params: { path: { project_id: projectId } },
      body,
    }),
  );
}

export async function listGalgameVideoExports(projectId: string) {
  return unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}/video-exports", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function cancelGalgameVideoExport(
  projectId: string,
  exportId: string,
) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/video-exports/{export_id}/cancel",
      {
        params: {
          path: { project_id: projectId, export_id: exportId },
        },
      },
    ),
  );
}

export async function downloadGalgameVideoExport(
  projectId: string,
  exportId: string,
  filename: string,
) {
  const blob = await fetchApiBlob(
    `/v1/galgame-workshop/projects/${encodeURIComponent(projectId)}/video-exports/${encodeURIComponent(exportId)}/download`,
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
