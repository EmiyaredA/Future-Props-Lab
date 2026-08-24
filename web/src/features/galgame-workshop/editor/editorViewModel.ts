import type { useGalgameWorkshopEditorController } from "@features/galgame-workshop/editor/useGalgameWorkshopEditorController";

export type EditorPageViewModel = ReturnType<
  typeof useGalgameWorkshopEditorController
>;
export type ReadyEditorPageViewModel = Extract<
  EditorPageViewModel,
  { status: "ready" }
>;
