import type { StoryTimelineEditorProps } from "@features/galgame-workshop/editor/storyTimelineEditorProps";
import { useStoryTimelineController } from "@features/galgame-workshop/editor/timeline/useStoryTimelineController";
import { StoryTimelineTracksView } from "@features/galgame-workshop/editor/timeline/StoryTimelineTracksView";

export function StoryTimelineEditor(props: StoryTimelineEditorProps) {
  const controller = useStoryTimelineController(props);
  return <StoryTimelineTracksView controller={controller} />;
}
