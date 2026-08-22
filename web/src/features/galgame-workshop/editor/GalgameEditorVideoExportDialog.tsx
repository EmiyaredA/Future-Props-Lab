import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { VideoExportDialog } from "@features/galgame-workshop/editor/VideoExportDialog";
import { videoExportLanguageOptions } from "@features/galgame-workshop/editor/videoExportLanguage";

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
  return (
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
  );
}
