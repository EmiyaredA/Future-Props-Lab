import type {
  GalgameStoryChapter,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { FastPreviewCursor } from "@features/galgame-workshop/editor/FastPreviewWorkspace";
import { entryChapter } from "@features/galgame-workshop/editor/model";

export type EditorFastPreviewSession = {
  document: GalgameStoryProject;
  startCursor: FastPreviewCursor;
};

export function createEditorFastPreviewSession({
  document,
  scope,
  chapter,
  selectedFragment,
  selectedIndex,
}: {
  document: GalgameStoryProject;
  scope: "project" | "chapter" | "block";
  chapter: GalgameStoryChapter;
  selectedFragment?: GalgameStoryFragment;
  selectedIndex?: number | null;
}): EditorFastPreviewSession {
  const targetChapter =
    scope === "project"
      ? (entryChapter(document) ?? document.chapters?.[0])
      : chapter;
  const targetFragment =
    scope === "block"
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
  };
}
