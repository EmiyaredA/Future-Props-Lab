import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPreviewRender,
  listPreviewRenders,
  cancelPreviewRender,
  clearPreviewRenders,
  type PreviewRender,
} from "./previewRenderApi";
import { videoEditorQueryKeys } from "./queryKeys";
import type { VideoEditorTimeline } from "./types";

export function usePreviewRender({
  projectId,
  revision,
  assetVersion = "",
  dirty,
  playing,
  waitForSavedTimeline,
  setMediaClockActive,
}: {
  projectId: string;
  revision?: number;
  assetVersion?: string;
  dirty: boolean;
  playing: boolean;
  waitForSavedTimeline: () => Promise<VideoEditorTimeline>;
  setMediaClockActive: (active: boolean) => void;
}) {
  const client = useQueryClient();
  const [active, setActive] = useState<PreviewRender>();
  const [failed, setFailed] = useState<string>();
  const [playbackError, setPlaybackError] = useState("");
  const wasPlaying = useRef(false);
  const queryKey = videoEditorQueryKeys.previewRenders(
    projectId,
    revision,
    assetVersion,
  );
  const query = useQuery({
    queryKey,
    queryFn: () => listPreviewRenders(projectId),
    enabled: revision !== undefined,
    refetchInterval: (query) =>
      query.state.data?.items.some((task) =>
        ["queued", "running"].includes(task.status),
      )
        ? 1000
        : false,
  });
  const candidate = query.data?.items.find(
    (task) =>
      task.valid && task.timelineRevision === revision && task.id !== failed,
  );
  const usable =
    active &&
    !dirty &&
    active.projectId === projectId &&
    active.timelineRevision === revision &&
    candidate?.id === active.id
      ? active
      : undefined;
  useLayoutEffect(() => {
    if (playing && !wasPlaying.current)
      setActive(dirty ? undefined : candidate);
    if (!playing) setActive(undefined);
    wasPlaying.current = playing;
  }, [playing, candidate, dirty]);
  useLayoutEffect(() => {
    setMediaClockActive(Boolean(usable && playing));
    return () => setMediaClockActive(false);
  }, [usable, playing, setMediaClockActive]);
  const refresh = () =>
    client.invalidateQueries({
      queryKey: videoEditorQueryKeys.previewRendersProject(projectId),
    });
  const create = useMutation({
    mutationFn: async () => {
      const timeline = await waitForSavedTimeline();
      return createPreviewRender(projectId, timeline.revision);
    },
    onSuccess: () => {
      setFailed(undefined);
      setPlaybackError("");
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (taskId: string) => cancelPreviewRender(projectId, taskId),
    onSuccess: refresh,
  });
  const clear = useMutation({
    mutationFn: () => clearPreviewRenders(projectId),
    onSuccess: () => {
      setActive(undefined);
      setFailed(undefined);
      setPlaybackError("");
      void refresh();
    },
  });
  const playbackFailed = useCallback((taskId: string) => {
    setFailed(taskId);
    setActive(undefined);
    setPlaybackError("预览缓存加载失败，已切回实时预览；可清理缓存后重新生成");
  }, []);
  useEffect(() => () => setMediaClockActive(false), [setMediaClockActive]);
  return {
    query,
    create,
    cancel,
    clear,
    active: usable,
    playbackFailed,
    playbackError,
    dirty,
  };
}

export type PreviewRenderControl = ReturnType<typeof usePreviewRender>;
