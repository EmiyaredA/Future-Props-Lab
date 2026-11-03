import { LoadingScene } from "@shared/ui/LoadingScene";
import { LoadingState } from "@shared/ui/LoadingState";
import { lazy, Suspense } from "react";
import { Film } from "lucide-react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import type { SegmentPreviewSelection } from "@features/galgame-workshop/editor/EditorSegmentPreviewDialog";
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
  initialClipRange,
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
  initialClipRange?: SegmentPreviewSelection;
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
              <LoadingState label="正在打开视频导出" variant="inline" />
              <LoadingState
                label="正在加载导出设置与任务状态…"
                variant="inline"
              />
            </span>
            <LoadingScene />
          </section>
        </div>
      }
    >
      <VideoExportDialog
        open={open}
        projectId={projectId}
        storyRevision={storyRevision}
        document={document}
        currentFragmentId={
          initialClipRange?.fragmentId ??
          playbackFollow?.fragmentId ??
          selectedFragmentId
        }
        currentTimelinePositionMs={
          initialClipRange?.startMs ??
          playbackFollow?.positionMs ??
          timelinePreviewMs ??
          0
        }
        initialClipRange={initialClipRange}
        languageOptions={videoExportLanguageOptions(document)}
        onClose={onClose}
      />
    </Suspense>
  );
}
