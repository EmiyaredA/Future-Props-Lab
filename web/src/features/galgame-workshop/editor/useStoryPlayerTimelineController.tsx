import { useCallback, useEffect, useRef } from "react";
import type { GalgameStoryFragment } from "@features/galgame-workshop/api";
import {
  chapterById,
  fragmentById,
} from "@features/galgame-workshop/editor/model";
import {
  emptyStageState,
  enterContentBlock,
  replayStageAtTime,
  replayStageToBlock,
} from "@features/galgame-workshop/editor/stage";
import { TimelineClock } from "@features/galgame-workshop/editor/timelineClock";
import {
  activeTimelineCue,
  timelineEvents,
  timelinePlaybackSteps,
} from "@features/galgame-workshop/editor/timeline";
import {
  advanceRuntime,
  chooseRuntimeFragment,
  initialRuntime,
  type StoryRuntimeResult,
} from "@features/galgame-workshop/editor/storyRuntime";
import { timelineExportBounds } from "@features/galgame-workshop/editor/useStoryPlayerPlaybackFollow";
import type { TimelinePlayback } from "@features/galgame-workshop/editor/storyPlayerModel";

const TIMELINE_UI_UPDATE_INTERVAL_MS = 100;

import type { StoryPlayerBase } from "./useStoryPlayerBase";

export function useStoryPlayerTimelineController(base: StoryPlayerBase) {
  const {
    activeFragment,
    advanceMode,
    advanceModeRef,
    channelGenerationRef,
    cleanupPlayback,
    document,
    executeAudioBlock,
    exportCompletedRef,
    exportMode,
    fadeAndStop,
    frame,
    generationRef,
    pauseTimelineMaster,
    playbackRange,
    playbackRangeRef,
    reconcileTimelineAudio,
    runtimeRef,
    setAdvanceMode,
    setFrame,
    setSelectedExportChoiceId,
    setTimelinePlaying,
    setTimelinePositionMs,
    setVoicePlaying,
    startCursor,
    syncTimelineAmbient,
    syncTimelineBgm,
    syncTimelineMaster,
    timelineMasterPositionMs,
    timelinePositionMs,
    timelineRef,
    voiceRef,
  } = base;
  const finishTimeline = useCallback(
    (fragment: GalgameStoryFragment) => {
      setTimelinePlaying(false);
      const terminatorIndex = (fragment.blocks ?? []).findIndex(
        (block) => block.type === "branch" || block.type === "endChapter",
      );
      const terminator = fragment.blocks?.[terminatorIndex];
      const stage = replayStageAtTime(
        document,
        fragment,
        fragment.timeline?.durationMs ?? 0,
      ).stage;
      runtimeRef.current = {
        ...runtimeRef.current,
        fragmentId: fragment.id,
        blockIndex:
          terminatorIndex < 0
            ? (fragment.blocks?.length ?? 0)
            : terminatorIndex,
        stage,
      };
      if (terminator?.type === "endChapter") {
        const result = advanceRuntime(document, runtimeRef.current);
        runtimeRef.current = result.state;
        setFrame(
          result.kind === "stopped"
            ? {
                mode: "ending",
                label: result.label,
                stage: result.state.stage,
              }
            : result.kind === "error"
              ? {
                  mode: "error",
                  message: result.message,
                  stage: result.state.stage,
                }
              : {
                  mode: "content",
                  fragmentId: result.state.fragmentId,
                  blockIndex: result.state.blockIndex,
                  block: result.block,
                  stage: result.state.stage,
                },
        );
        return;
      }
      setFrame(
        terminator?.type === "branch"
          ? {
              mode: "content",
              fragmentId: fragment.id,
              blockIndex: terminatorIndex,
              block: terminator,
              stage: enterContentBlock(stage, terminator, document),
            }
          : {
              mode: "ending",
              label: "故事结束",
              stage,
            },
      );
    },
    [document, runtimeRef, setFrame, setTimelinePlaying],
  );

  const timelineVisualKeyRef = useRef("");
  useEffect(() => {
    timelineVisualKeyRef.current = "";
  }, [document]);

  const showTimelinePosition = useCallback(
    (fragment: GalgameStoryFragment, milliseconds: number) => {
      const events = timelineEvents(fragment);
      let eventCount = 0;
      while (
        eventCount < events.length &&
        events[eventCount]!.timeMs <= milliseconds
      )
        eventCount += 1;
      const activeCue = activeTimelineCue(fragment, milliseconds);
      const visualKey = `${fragment.id}:${eventCount}:${activeCue?.blockIndex ?? "stage"}`;
      if (timelineVisualKeyRef.current === visualKey) return;
      timelineVisualKeyRef.current = visualKey;
      const preview = replayStageAtTime(document, fragment, milliseconds);
      setFrame(
        preview.block && preview.blockIndex != null
          ? {
              mode: "content",
              fragmentId: fragment.id,
              blockIndex: preview.blockIndex,
              block: preview.block,
              stage: preview.stage,
            }
          : {
              mode: "stageOnly",
              fragmentId: fragment.id,
              stage: preview.stage,
            },
      );
    },
    [document, setFrame],
  );

  const playTimeline = useCallback(
    async (
      fragment: GalgameStoryFragment,
      clock: TimelineClock,
      stopAtMs?: number,
    ) => {
      if (
        fragment.timeline?.masterAudio &&
        !(await syncTimelineMaster(fragment, clock.position, true))
      )
        return;
      if (stopAtMs == null) clock.play();
      else clock.playUntil(stopAtMs);
    },
    [syncTimelineMaster],
  );

  const startTimeline = useCallback(
    (fragment: GalgameStoryFragment, autoplay = advanceMode === "auto") => {
      if (!fragment.timeline) return;
      const timelineDurationMs = fragment.timeline.durationMs;
      const requestedRange = exportMode?.timelineRange ?? playbackRange;
      const { range, startMs, endMs } = timelineExportBounds(
        fragment,
        requestedRange,
      );
      showTimelinePosition(fragment, startMs);
      setTimelinePositionMs(startMs);
      const playerGeneration = generationRef.current;
      const audioEvents = timelineEvents(fragment).filter(
        (event) => event.block.type === "audio",
      );
      const playback = { current: undefined as TimelinePlayback | undefined };
      const clock = new TimelineClock(timelineDurationMs, {
        onPosition: (milliseconds) => {
          const playing = playback.current;
          if (
            !playing ||
            playerGeneration !== generationRef.current ||
            timelineRef.current !== playing
          )
            return;
          if (milliseconds >= playing.lastPositionMs)
            for (const event of audioEvents) {
              if (
                event.timeMs <= playing.lastPositionMs ||
                event.timeMs > milliseconds ||
                event.block.type !== "audio"
              )
                continue;
              executeAudioBlock(event.block);
            }
          playing.lastPositionMs = milliseconds;
          if (
            exportMode ||
            milliseconds < playing.lastPublishedPositionMs ||
            milliseconds - playing.lastPublishedPositionMs >=
              TIMELINE_UI_UPDATE_INTERVAL_MS
          ) {
            playing.lastPublishedPositionMs = milliseconds;
            setTimelinePositionMs(milliseconds);
          }
          showTimelinePosition(fragment, milliseconds);
        },
        onPlayingChange: (next) => {
          const playing = playback.current;
          if (timelineRef.current !== playing || !playing) return;
          setTimelinePlaying(next);
          if (!next) {
            playing.lastPublishedPositionMs = playing.lastPositionMs;
            setTimelinePositionMs(playing.lastPositionMs);
          }
          syncTimelineBgm(fragment, Math.max(0, playing.lastPositionMs), next);
          syncTimelineAmbient(
            fragment,
            Math.max(0, playing.lastPositionMs),
            next,
          );
          if (!next) pauseTimelineMaster();
        },
        onBoundary: (milliseconds) => {
          if (!range || milliseconds < endMs) return;
          if (exportMode) {
            if (exportCompletedRef.current) return;
            exportCompletedRef.current = true;
            exportMode.onComplete?.({ ok: true, label: "快速试片完成" });
            return;
          }
          const latestRange = playbackRangeRef.current;
          if (!latestRange?.loop || latestRange.fragmentId !== fragment.id)
            return;
          clock.seek(startMs);
          reconcileTimelineAudio(fragment, startMs);
          showTimelinePosition(fragment, startMs);
          setTimelinePositionMs(startMs);
          void playTimeline(fragment, clock, endMs);
        },
        onFinish: () => {
          const playing = playback.current;
          if (
            !playing ||
            playerGeneration !== generationRef.current ||
            timelineRef.current !== playing
          )
            return;
          finishTimeline(fragment);
        },
        // Export audio is muxed from the source asset after Chromium captures
        // the stage. Driving the export clock from HTMLAudioElement.currentTime
        // can stall indefinitely when headless media playback is throttled.
        positionSource:
          fragment.timeline.masterAudio && !exportMode
            ? timelineMasterPositionMs
            : undefined,
      });
      const playing = {
        fragmentId: fragment.id,
        clock,
        lastPositionMs: startMs,
        lastPublishedPositionMs: Number.NEGATIVE_INFINITY,
      };
      playback.current = playing;
      timelineRef.current = playing;
      const firstStep = timelinePlaybackSteps(fragment)[0];
      if (fragment.timeline.masterAudio) {
        clock.seek(startMs);
        syncTimelineBgm(fragment, startMs, false);
        syncTimelineAmbient(fragment, startMs, false);
        void syncTimelineMaster(fragment, startMs, false).then((ready) => {
          if (
            ready &&
            autoplay &&
            playerGeneration === generationRef.current &&
            timelineRef.current === playing
          )
            void playTimeline(fragment, clock, range ? endMs : undefined);
        });
      } else {
        clock.seek(range ? startMs : autoplay ? 0 : (firstStep?.startMs ?? 0));
        syncTimelineBgm(fragment, startMs, false);
        syncTimelineAmbient(fragment, startMs, false);
        if (autoplay)
          void playTimeline(fragment, clock, range ? endMs : undefined);
        else if (firstStep)
          clock.playUntil(Math.max(firstStep.startMs, firstStep.endMs - 1));
      }
    },
    [
      advanceMode,
      executeAudioBlock,
      exportCompletedRef,
      exportMode,
      finishTimeline,
      generationRef,
      pauseTimelineMaster,
      playbackRange,
      playbackRangeRef,
      playTimeline,
      reconcileTimelineAudio,
      setTimelinePlaying,
      setTimelinePositionMs,
      showTimelinePosition,
      syncTimelineBgm,
      syncTimelineAmbient,
      syncTimelineMaster,
      timelineMasterPositionMs,
      timelineRef,
    ],
  );

  const presentRuntime = useCallback(
    (result: StoryRuntimeResult) => {
      runtimeRef.current = result.state;
      if (result.effects.some((effect) => effect.type === "returnToEntry"))
        cleanupPlayback();
      for (const effect of result.effects)
        if (effect.type === "audio") executeAudioBlock(effect);
      if (result.kind === "error") {
        setFrame({
          mode: "error",
          message: result.message,
          stage: result.state.stage,
        });
        return;
      }
      if (result.kind === "stopped") {
        setFrame({
          mode: "ending",
          label: result.label,
          stage: result.state.stage,
        });
        return;
      }
      setFrame({
        mode: "content",
        fragmentId: result.state.fragmentId,
        blockIndex: result.state.blockIndex,
        block: result.block,
        stage: result.state.stage,
      });
    },
    [cleanupPlayback, executeAudioBlock, runtimeRef, setFrame],
  );

  const restart = () => {
    cleanupPlayback();
    exportCompletedRef.current = false;
    setSelectedExportChoiceId(undefined);
    const autoplay = Boolean(exportMode || playbackRange?.autoPlay);
    setAdvanceMode(autoplay ? "auto" : "manual");
    advanceModeRef.current = autoplay ? "auto" : "manual";
    const base = initialRuntime(document);
    const startChapter = startCursor
      ? chapterById(document, startCursor.chapterId)
      : undefined;
    const startFragment =
      startChapter && startCursor
        ? fragmentById(startChapter, startCursor.fragmentId)
        : undefined;
    const startIndex = Math.max(0, startCursor?.blockIndex ?? 0);
    const initial =
      startChapter && startFragment
        ? {
            ...base,
            chapterId: startChapter.id,
            fragmentId: startFragment.id,
            blockIndex: startIndex,
            stage: replayStageToBlock(document, startFragment, startIndex),
          }
        : base;
    runtimeRef.current = initial;
    const initialChapter = chapterById(document, initial.chapterId);
    if (!initialChapter) {
      setFrame({
        mode: "error",
        message: "工程没有可试玩章节",
        stage: emptyStageState(),
      });
      return;
    }
    const entryFragment = fragmentById(initialChapter, initial.fragmentId);
    if (entryFragment?.timeline) {
      startTimeline(entryFragment, autoplay);
      return;
    }
    presentRuntime(advanceRuntime(document, initial));
  };
  const enterFragment = (fragmentId: string) => {
    pauseTimelineMaster();
    timelineRef.current?.clock.dispose();
    timelineRef.current = null;
    const next = chooseRuntimeFragment(
      document,
      runtimeRef.current,
      fragmentId,
    );
    runtimeRef.current = next;
    const targetChapter = chapterById(document, next.chapterId);
    const target = targetChapter
      ? fragmentById(targetChapter, fragmentId)
      : undefined;
    if (target?.timeline) {
      startTimeline(target, advanceMode === "auto");
      return;
    }
    presentRuntime(advanceRuntime(document, next));
  };
  useEffect(() => {
    if (!exportMode) return;
    restart();
    // Export mode owns the complete player lifecycle and starts exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      !exportMode ||
      frame.mode !== "content" ||
      frame.block.type !== "branch"
    )
      return;
    const choiceId = exportMode.branchSelections[frame.block.id];
    const choice = frame.block.choices.find((item) => item.id === choiceId);
    if (!choice) {
      if (!exportCompletedRef.current) {
        exportCompletedRef.current = true;
        exportMode.onComplete?.({ ok: false, label: "导出路线缺少分支选择" });
      }
      return;
    }
    const highlightAt = Math.max(
      0,
      exportMode.choiceDurationMs - exportMode.choiceHighlightMs,
    );
    const highlight = window.setTimeout(
      () => setSelectedExportChoiceId(choice.id),
      highlightAt,
    );
    const select = window.setTimeout(() => {
      setSelectedExportChoiceId(undefined);
      enterFragment(choice.targetFragmentId);
    }, exportMode.choiceDurationMs);
    return () => {
      window.clearTimeout(highlight);
      window.clearTimeout(select);
    };
    // The timer must remain tied to this rendered branch; enterFragment is
    // intentionally read from the same render instead of restarting on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportMode, frame]);
  const seekTimeline = (milliseconds: number, triggerPointEffects = false) => {
    const playing = timelineRef.current;
    if (!playing || !activeFragment?.timeline) return;
    const activeRange =
      playbackRangeRef.current?.fragmentId === activeFragment.id
        ? playbackRangeRef.current
        : undefined;
    const minimum = activeRange?.startMs ?? 0;
    const maximum = Math.min(
      activeFragment.timeline.durationMs,
      activeRange?.endMs ?? activeFragment.timeline.durationMs,
    );
    const target = Math.max(minimum, Math.min(maximum, milliseconds));
    if (advanceModeRef.current === "manual") playing.clock.pause();
    playing.lastPositionMs = target;
    playing.lastPublishedPositionMs = target;
    setTimelinePositionMs(target);
    reconcileTimelineAudio(activeFragment, target);
    if (triggerPointEffects)
      for (const event of timelineEvents(activeFragment))
        if (
          event.timeMs === target &&
          event.block.type === "audio" &&
          event.block.channel === "sfx" &&
          event.block.action === "play"
        )
          executeAudioBlock(event.block);
    playing.clock.seek(target);
    void syncTimelineMaster(activeFragment, target, playing.clock.isPlaying);
    if (target >= activeFragment.timeline.durationMs) {
      finishTimeline(activeFragment);
    }
  };
  const fadeCurrentVoice = () => {
    channelGenerationRef.current.voice += 1;
    const playing = voiceRef.current;
    voiceRef.current = null;
    setVoicePlaying(false);
    if (playing)
      exportMode?.onAudioEvent?.({
        action: "stop",
        channel: "voice",
        fadeMs: 80,
      });
    if (playing) fadeAndStop(playing, 80);
  };
  const skipTimelineStep = (direction: -1 | 1) => {
    if (!activeFragment) return;
    fadeCurrentVoice();
    const activeRange =
      playbackRangeRef.current?.fragmentId === activeFragment.id
        ? playbackRangeRef.current
        : undefined;
    const steps = timelinePlaybackSteps(activeFragment).filter(
      (step) =>
        !activeRange ||
        (step.endMs > activeRange.startMs && step.startMs < activeRange.endMs),
    );
    if (!steps.length) return;
    const currentIndex =
      frame.mode === "content"
        ? steps.findIndex(
            ({ contentBlockIndex }) => contentBlockIndex === frame.blockIndex,
          )
        : Math.max(
            0,
            steps.findIndex(
              (step, index) =>
                step.startMs <= timelinePositionMs &&
                (timelinePositionMs < step.endMs ||
                  (index === steps.length - 1 &&
                    timelinePositionMs <= step.endMs)),
            ),
          );
    const nextIndex = Math.max(
      0,
      Math.min(steps.length - 1, currentIndex + direction),
    );
    if (direction === 1 && currentIndex >= steps.length - 1)
      seekTimeline(
        activeRange?.endMs ?? activeFragment.timeline?.durationMs ?? 0,
        true,
      );
    else {
      const nextStep = steps[nextIndex];
      seekTimeline(nextStep?.startMs ?? 0, true);
      if (advanceModeRef.current === "manual" && nextStep)
        void playTimeline(
          activeFragment,
          timelineRef.current!.clock,
          Math.max(nextStep.startMs, nextStep.endMs - 1),
        );
    }
  };
  const toggleTimeline = () => {
    const playing = timelineRef.current;
    if (!playing) return;
    const { clock } = playing;
    if (!clock.isPlaying) {
      const activeRange =
        activeFragment &&
        playbackRangeRef.current?.fragmentId === activeFragment.id
          ? playbackRangeRef.current
          : undefined;
      if (
        clock.position >=
          (activeRange?.endMs ?? activeFragment?.timeline?.durationMs ?? 0) ||
        clock.position < (activeRange?.startMs ?? 0)
      )
        seekTimeline(activeRange?.startMs ?? 0);
      setAdvanceMode("auto");
      if (activeFragment)
        void playTimeline(activeFragment, clock, activeRange?.endMs);
    } else {
      clock.pause();
      setAdvanceMode("manual");
    }
  };
  const selectAdvanceMode = (next: "manual" | "auto" | "skip") => {
    setAdvanceMode(next);
    const playing = timelineRef.current;
    if (!playing) return;
    if (next === "auto" || next === "skip") {
      if (playing.clock.position >= (activeFragment?.timeline?.durationMs ?? 0))
        playing.clock.seek(0);
      if (activeFragment) void playTimeline(activeFragment, playing.clock);
    } else playing.clock.pause();
  };
  return {
    enterFragment,
    fadeCurrentVoice,
    presentRuntime,
    restart,
    seekTimeline,
    selectAdvanceMode,
    skipTimelineStep,
    toggleTimeline,
  };
}
