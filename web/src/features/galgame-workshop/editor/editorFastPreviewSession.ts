import type {
  GalgameStoryChapter,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { FastPreviewCursor } from "@features/galgame-workshop/editor/storyPlayerModel";
import { entryChapter } from "@features/galgame-workshop/editor/model";
import type { StoryPlayerPlaybackRange } from "@features/galgame-workshop/editor/storyPlayerModel";

export type EditorFastPreviewSession = {
  document: GalgameStoryProject;
  startCursor: FastPreviewCursor;
  playbackRange?: StoryPlayerPlaybackRange;
};

export function createEditorFastPreviewSession({
  document,
  scope,
  chapter,
  selectedFragment,
  selectedIndex,
  playbackRange,
}: {
  document: GalgameStoryProject;
  scope: "project" | "chapter" | "block" | "range";
  chapter: GalgameStoryChapter;
  selectedFragment?: GalgameStoryFragment;
  selectedIndex?: number | null;
  playbackRange?: StoryPlayerPlaybackRange;
}): EditorFastPreviewSession {
  const targetChapter =
    scope === "project"
      ? (entryChapter(document) ?? document.chapters?.[0])
      : chapter;
  const targetFragment =
    scope === "block" || scope === "range"
      ? selectedFragment
      : (targetChapter?.fragments?.find(
          (fragment) => fragment.id === targetChapter.entryFragmentId,
        ) ?? targetChapter?.fragments?.[0]);
  return {
    document: structuredClone(document),
    startCursor: {
      chapterId: targetChapter?.id ?? "",
      fragmentId: targetFragment?.id ?? "",
      blockIndex: scope === "block" ? Math.max(0, selectedIndex ?? 0) : 0,
    },
    playbackRange: scope === "range" ? playbackRange : undefined,
  };
}
