import { api, unwrap } from "@platform/api/client";
import type { ProjectPreview } from "@shared/ui/project-library/ProjectCoverPreview";

/** The existing read-only precise-frame endpoint does not enqueue a video export. */
export async function renderGalgameCover(
  projectId: string,
  preview: ProjectPreview,
  signal: AbortSignal,
) {
  if (!preview.source_id || preview.source_revision == null)
    throw new Error("故事暂无可用画面");
  const blob = await unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/video-exports/frame",
      {
        params: { path: { project_id: projectId } },
        signal,
        parseAs: "blob",
        body: {
          expectedStoryRevision: preview.source_revision,
          locale: "zh",
          scope: "fragments",
          fragmentIds: [preview.source_id],
          timeMs: preview.source_time ?? 0,
          width: 640,
          preset: "720p30",
        },
      },
    ),
  );
  if (!(blob instanceof Blob)) throw new Error("故事预览未返回图像");
  return blob;
}
