import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@platform/api/client";
import {
  applyVideoEditorOperations,
  getVideoEditorProject,
  getVideoEditorTimeline,
  listVideoEditorAssets,
  listVideoEditorRenders,
} from "./api";
import type { VideoEditorOperation } from "./types";
import { frameUs, timelineDuration } from "./editorModel";

type HistoryEntry = { redo: VideoEditorOperation[]; undo: VideoEditorOperation[] };

export function useVideoEditor(projectId: string) {
  const client = useQueryClient();
  const project = useQuery({
    queryKey: ["video-editor-project", projectId],
    queryFn: () => getVideoEditorProject(projectId),
  });
  const timeline = useQuery({
    queryKey: ["video-editor-timeline", projectId],
    queryFn: () => getVideoEditorTimeline(projectId),
  });
  const assets = useQuery({
    queryKey: ["video-editor-assets", projectId],
    queryFn: () => listVideoEditorAssets(projectId),
    refetchInterval: (query) =>
      query.state.data?.items.some((asset) =>
        ["queued", "processing"].includes(asset.processingStatus),
      )
        ? 1000
        : false,
  });
  const tasks = useQuery({
    queryKey: ["video-editor-renders", projectId],
    queryFn: () => listVideoEditorRenders(projectId),
    refetchInterval: 1200,
  });
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const [playheadUs, setPlayheadUs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(80);
  const [notice, setNotice] = useState("");
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const clock = useRef({ startedAt: 0, startedUs: 0 });

  const mutation = useMutation({
    mutationFn: ({ operations }: { operations: VideoEditorOperation[] }) => {
      if (!timeline.data) throw new Error("时间轴尚未就绪");
      return applyVideoEditorOperations(
        projectId,
        timeline.data.revision,
        operations,
      );
    },
    onSuccess: (next) => {
      client.setQueryData(["video-editor-timeline", projectId], next);
      setNotice("已自动保存");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.problem.code === "revision_conflict") {
        setNotice("服务器版本已更新，已载入最新时间轴；本次操作未覆盖他人修改。");
        void timeline.refetch();
      } else setNotice(error instanceof Error ? error.message : "保存失败");
    },
  });

  const commit = useCallback(
    async (redo: VideoEditorOperation[], undo: VideoEditorOperation[] = []) => {
      await mutation.mutateAsync({ operations: redo });
      if (undo.length) {
        setUndoStack((items) => [...items.slice(-99), { redo, undo }]);
        setRedoStack([]);
      }
    },
    [mutation],
  );
  const undo = async () => {
    const entry = undoStack.at(-1);
    if (!entry) return;
    await mutation.mutateAsync({ operations: entry.undo });
    setUndoStack((items) => items.slice(0, -1));
    setRedoStack((items) => [...items, entry]);
  };
  const redo = async () => {
    const entry = redoStack.at(-1);
    if (!entry) return;
    await mutation.mutateAsync({ operations: entry.redo });
    setRedoStack((items) => items.slice(0, -1));
    setUndoStack((items) => [...items, entry]);
  };

  const durationUs = timelineDuration(timeline.data);
  useEffect(() => {
    if (!playing) return;
    clock.current = { startedAt: performance.now(), startedUs: playheadUs };
    let frame = 0;
    const tick = () => {
      const next =
        clock.current.startedUs +
        (performance.now() - clock.current.startedAt) * 1000;
      if (next >= durationUs) {
        setPlayheadUs(durationUs);
        setPlaying(false);
        return;
      }
      setPlayheadUs(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationUs, playing]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        const fps = timeline.data?.document.settings?.fps ?? 30;
        setPlaying(false);
        setPlayheadUs((value) =>
          Math.max(0, Math.min(durationUs, value + (event.code === "ArrowLeft" ? -1 : 1) * frameUs(fps))),
        );
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [durationUs, timeline.data]);

  const selected = (timeline.data?.document.tracks ?? [])
    .flatMap((track) => track.clips ?? [])
    .find((clip) => clip.id === selectedClipId);
  return {
    project,
    timeline,
    assets,
    tasks,
    selected,
    selectedClipId,
    setSelectedClipId,
    playheadUs,
    setPlayheadUs,
    playing,
    setPlaying,
    durationUs,
    zoom,
    setZoom,
    notice,
    setNotice,
    commit,
    undo,
    redo,
    canUndo: Boolean(undoStack.length),
    canRedo: Boolean(redoStack.length),
    saving: mutation.isPending,
  };
}
