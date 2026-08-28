import { forwardRef, useEffect, useImperativeHandle } from "react";
import { StoryPlayerView } from "@features/galgame-workshop/editor/StoryPlayerView";
import { StoryImageCacheProvider } from "@features/galgame-workshop/editor/StoryImageCache";
import { StoryPlayerImageWarmup } from "@features/galgame-workshop/editor/StoryPlayerImageWarmup";
import { useStoryPlayerController } from "@features/galgame-workshop/editor/useStoryPlayerController";
import type {
  StoryPlayerHandle,
  StoryPlayerProps,
} from "@features/galgame-workshop/editor/storyPlayerModel";
import { playerFrameCursor } from "@features/galgame-workshop/editor/storyPlayerModel";

export type { StoryPlayerHandle };

export const StoryPlayer = forwardRef<StoryPlayerHandle, StoryPlayerProps>(
  function StoryPlayer(props, ref) {
    const model = useStoryPlayerController(props);
    const { onRuntimeSnapshot } = props;
    useImperativeHandle(ref, () => ({
      restart: model.restart,
      advance: model.advance,
      togglePlayback: () =>
        model.activeTimeline ? model.toggleTimeline() : model.advance(),
      seekTimeline: (positionMs) => model.seekTimeline(positionMs, true),
      previousDialogue: () => {
        if (model.activeTimeline) model.skipTimelineStep(-1);
      },
      nextDialogue: () =>
        model.activeTimeline ? model.skipTimelineStep(1) : model.advance(),
    }));
    useEffect(() => {
      const frameCursor = playerFrameCursor(
        model.frame,
        model.runtimeRef.current,
      );
      onRuntimeSnapshot?.({
        frame: model.frame,
        stage: model.frame.stage,
        variables: model.runtimeRef.current.variables,
        chapterId: model.runtimeRef.current.chapterId,
        fragmentId: frameCursor.fragmentId,
        blockIndex: frameCursor.blockIndex,
        positionMs: model.timelinePositionMs,
        durationMs: model.activeTimeline?.durationMs,
        playing: model.timelinePlaying,
        advanceMode: model.advanceMode,
      });
    }, [
      model.activeTimeline?.durationMs,
      model.advanceMode,
      model.frame,
      model.runtimeRef,
      model.timelinePlaying,
      model.timelinePositionMs,
      onRuntimeSnapshot,
    ]);
    return (
      <StoryImageCacheProvider>
        <StoryPlayerImageWarmup fileIds={props.preloadFileIds ?? []} />
        <StoryPlayerView model={model} />
      </StoryImageCacheProvider>
    );
  },
);
