import { useCallback, useEffect, useRef, useState } from "react";
import {
  previewGalgameVideoExportFrame,
  type GalgameStoryFragment,
} from "@features/galgame-workshop/api";
import type { StoryPlayerRuntimeSnapshot } from "@features/galgame-workshop/editor/storyPlayerModel";

type ExactFrame = {
  url: string;
  fragmentId: string;
  timeMs: number;
};

export function useFastPreviewExactFrame({
  projectId,
  revision,
  disabledReason,
  hasDirtyDrafts,
  activeFragment,
  snapshot,
  pausePlayback,
}: {
  projectId?: string;
  revision?: number;
  disabledReason?: string;
  hasDirtyDrafts: boolean;
  activeFragment?: GalgameStoryFragment;
  snapshot?: StoryPlayerRuntimeSnapshot;
  pausePlayback: () => void;
}) {
  const [exactFrame, setExactFrame] = useState<ExactFrame>();
  const [exactFrameLoading, setExactFrameLoading] = useState(false);
  const [exactFrameError, setExactFrameError] = useState("");
  const requestRef = useRef(0);
  const urlRef = useRef("");

  const invalidateExactFrame = useCallback(() => {
    requestRef.current += 1;
    setExactFrameLoading(false);
    setExactFrameError("");
    setExactFrame(undefined);
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = "";
    }
  }, []);

  useEffect(
    () => () => {
      requestRef.current += 1;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const exactFrameUnavailableReason =
    disabledReason ??
    (hasDirtyDrafts
      ? "请先保存全部实时草稿，再生成精确导出帧"
      : !projectId || revision == null
        ? "当前快照缺少已保存的项目修订信息"
        : !activeFragment?.timeline
          ? "当前片段没有精确时间轴"
          : !snapshot
            ? "快速预演尚未就绪"
            : undefined);
  const exactFrameStale = Boolean(
    exactFrame &&
    snapshot &&
    (exactFrame.fragmentId !== snapshot.fragmentId ||
      Math.abs(exactFrame.timeMs - snapshot.positionMs) >= 100),
  );

  const generateExactFrame = async () => {
    if (
      exactFrameUnavailableReason ||
      !projectId ||
      revision == null ||
      !activeFragment?.timeline ||
      !snapshot
    )
      return;
    if (snapshot.playing) pausePlayback();
    const requestId = ++requestRef.current;
    const fragmentId = activeFragment.id;
    const timelineTimeMs = Math.min(
      snapshot.positionMs,
      Math.max(0, activeFragment.timeline.durationMs - 1),
    );
    const clipStartMs = Math.max(0, timelineTimeMs - 1000);
    const clipEndMs = Math.min(
      activeFragment.timeline.durationMs,
      timelineTimeMs + 1001,
    );
    setExactFrameLoading(true);
    setExactFrameError("");
    try {
      const blob = await previewGalgameVideoExportFrame(projectId, {
        expectedStoryRevision: revision,
        locale: "zh",
        preset: "1080p30",
        scope: "clip",
        fragmentIds: [],
        branchSelections: [],
        captureFrame: { x: 0, y: 0, width: 1920, height: 1080 },
        clipRange: {
          fragmentId,
          startMs: clipStartMs,
          endMs: clipEndMs,
        },
        timeMs: timelineTimeMs - clipStartMs,
        width: 960,
      });
      if (requestId !== requestRef.current) return;
      const url = URL.createObjectURL(blob);
      const previousUrl = urlRef.current;
      urlRef.current = url;
      setExactFrame({ url, fragmentId, timeMs: timelineTimeMs });
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      setExactFrameError(
        error instanceof Error ? error.message : "精确导出帧生成失败",
      );
    } finally {
      if (requestId === requestRef.current) setExactFrameLoading(false);
    }
  };

  return {
    clearExactFrameError: () => setExactFrameError(""),
    closeExactFrame: invalidateExactFrame,
    exactFrame,
    exactFrameError,
    exactFrameLoading,
    exactFrameStale,
    exactFrameUnavailableReason,
    generateExactFrame,
    invalidateExactFrame,
  };
}
