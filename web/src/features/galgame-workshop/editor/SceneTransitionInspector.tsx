import type {
  GalgameStoryBlock,
  GalgameStoryCgTransition,
} from "@features/galgame-workshop/api";
import { CgTransitionFields } from "@features/galgame-workshop/editor/InspectorFieldControls";

type SceneBlock = Extract<GalgameStoryBlock, { type: "scene" }>;

export function SceneTransitionInspector({
  block,
  patch,
}: {
  block: SceneBlock;
  patch: (updater: (current: GalgameStoryBlock) => GalgameStoryBlock) => void;
}) {
  return (
    <CgTransitionFields
      transition={block.transition}
      label="场景"
      defaultValue={{ durationMs: 0, fade: false }}
      onChange={(transition: GalgameStoryCgTransition) =>
        patch((current) =>
          current.type === "scene" ? { ...current, transition } : current,
        )
      }
    />
  );
}
