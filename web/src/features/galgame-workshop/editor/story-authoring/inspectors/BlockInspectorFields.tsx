import { CoreBlockInspectorFields } from "@features/galgame-workshop/editor/story-authoring/inspectors/CoreBlockInspectorFields";
import { FlowBlockInspectorFields } from "@features/galgame-workshop/editor/story-authoring/inspectors/FlowBlockInspectorFields";
import { MediaBlockInspectorFields } from "@features/galgame-workshop/editor/story-authoring/inspectors/MediaBlockInspectorFields";
import { TextBlockInspectorFields } from "@features/galgame-workshop/editor/story-authoring/inspectors/TextBlockInspectorFields";
import type { BlockInspectorViewModel } from "@features/galgame-workshop/editor/story-authoring/inspectors/types";

export function BlockInspectorFields({
  model,
}: {
  model: BlockInspectorViewModel;
}) {
  if (
    model.block.type === "narration" ||
    model.block.type === "dialogue" ||
    model.block.type === "storyParagraph"
  )
    return <TextBlockInspectorFields model={model} />;
  if (
    model.block.type === "wait" ||
    model.block.type === "audio" ||
    model.block.type === "curtain" ||
    model.block.type === "video"
  )
    return <MediaBlockInspectorFields model={model} />;
  if (
    model.block.type === "branch" ||
    model.block.type === "endChapter" ||
    model.block.type === "returnToEntry"
  )
    return <FlowBlockInspectorFields model={model} />;
  return <CoreBlockInspectorFields model={model} />;
}
