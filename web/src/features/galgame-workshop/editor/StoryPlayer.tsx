import { forwardRef } from "react";
import { StoryPlayerView } from "@features/galgame-workshop/editor/StoryPlayerView";
import { useStoryPlayerController } from "@features/galgame-workshop/editor/useStoryPlayerController";
import type {
  StoryPlayerHandle,
  StoryPlayerProps,
} from "@features/galgame-workshop/editor/storyPlayerModel";

export type { StoryPlayerHandle };

export const StoryPlayer = forwardRef<StoryPlayerHandle, StoryPlayerProps>(
  function StoryPlayer(props, ref) {
    return <StoryPlayerView model={useStoryPlayerController(props, ref)} />;
  },
);
