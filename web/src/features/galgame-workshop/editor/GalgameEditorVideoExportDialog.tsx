import { lazy, Suspense } from "react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { videoExportLanguageOptions } from "@features/galgame-workshop/editor/videoExportLanguage";

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
    <Suspense fallback={null}>
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
