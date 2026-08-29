import type { useBlockInspectorController } from "@features/galgame-workshop/editor/useBlockInspectorController";

export type BlockInspectorControllerModel = ReturnType<
  typeof useBlockInspectorController
>;
export type BlockInspectorViewModel = Extract<
  BlockInspectorControllerModel,
  { status: "ready" }
>;
