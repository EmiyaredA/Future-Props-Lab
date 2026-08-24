import { lazy, Suspense } from "react";
import { Film, LoaderCircle } from "lucide-react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { videoExportLanguageOptions } from "@features/galgame-workshop/editor/videoExportLanguage";
import "@features/galgame-workshop/editor/video-export.css";
import "@features/galgame-workshop/editor/video-export-feedback.css";

const VideoExportDialog = lazy(() =>
  import("@features/galgame-workshop/editor/VideoExportDialog").then(
    (module) => ({ default: module.VideoExportDialog }),
  ),
);

export function GalgameEditorVideoExportDialog({
  open,
  projectId,
  storyRevision,
  document,
  currentContext,
  onClose,
}: {
  open: boolean;
  projectId: string;
  storyRevision: number;
  document: GalgameStoryProject;
  currentContext: [
    { fragmentId: string; positionMs: number } | undefined,
    string | undefined,
    number | null | undefined,
  ];
  onClose: () => void;
}) {
  const [playbackFollow, selectedFragmentId, timelinePreviewMs] =
    currentContext;
  if (!open) return null;
  return (
    <Suspense
      fallback={
        <div className="galgame-video-export-backdrop" role="presentation">
          <section
            className="galgame-video-export-loading-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="正在打开视频导出"
          >
            <Film aria-hidden />
            <span>
              <strong>正在打开视频导出</strong>
              <small>正在加载导出设置与任务状态…</small>
            </span>
            <LoaderCircle className="spinning" aria-hidden />
          </section>
        </div>
      }
    >
      <VideoExportDialog
        open={open}
        projectId={projectId}
        storyRevision={storyRevision}
        document={document}
        currentFragmentId={playbackFollow?.fragmentId ?? selectedFragmentId}
        currentTimelinePositionMs={
          playbackFollow?.positionMs ?? timelinePreviewMs ?? 0
        }
        languageOptions={videoExportLanguageOptions(document)}
        onClose={onClose}
      />
    </Suspense>
  );
}
