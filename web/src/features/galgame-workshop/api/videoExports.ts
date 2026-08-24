import type { components } from "@generated/api";
import { api, fetchApiBlob, unwrap } from "@platform/api/client";

type PreviewIn = components["schemas"]["GalgameVideoExportPreviewIn"];
type CreateIn = components["schemas"]["GalgameVideoExportCreateIn"];
type HandoffCreateIn =
  components["schemas"]["GalgameVideoEditorHandoffCreateIn"];

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

export async function previewGalgameVideoExportFrame(
  projectId: string,
  body: components["schemas"]["GalgameVideoExportFrameIn"],
) {
  const result = await api.POST(
    "/v1/galgame-workshop/projects/{project_id}/video-exports/frame",
    {
      params: { path: { project_id: projectId } },
      body,
      parseAs: "blob",
    },
  );
  return (await unwrap(result)) as Blob;
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

export async function createGalgameVideoEditorHandoff(
  projectId: string,
  body: HandoffCreateIn,
) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/video-editor-handoffs",
      { params: { path: { project_id: projectId } }, body },
    ),
  );
}

export async function listGalgameVideoEditorHandoffs(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/video-editor-handoffs",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function cancelGalgameVideoEditorHandoff(
  projectId: string,
  taskId: string,
) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/video-editor-handoffs/{task_id}/cancel",
      { params: { path: { project_id: projectId, task_id: taskId } } },
    ),
  );
}
