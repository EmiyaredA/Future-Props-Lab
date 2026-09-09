import { DEFAULT_EDITOR_LAYOUT } from "./editorLayout";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@platform/api/client";
import {
  applyVideoEditorOperations,
  getVideoEditorProject,
  getVideoEditorTimeline,
  listVideoEditorAssets,
  listVideoEditorRenders,
  patchVideoEditorProject,
} from "./api";
import type { VideoEditorOperation } from "./types";
import { frameUs, timelineDuration } from "./editorModel";
import { canPlaceClip, linkedClipIds } from "./timelineSnap";
import { videoEditorQueryKeys } from "./queryKeys";
import {
  loadVideoEditorWorkspacePreferences,
  storeVideoEditorWorkspacePreferences,
  type VideoEditorWorkspacePreferences,
} from "./workspacePreferences";

type HistoryEntry = {
  redo: VideoEditorOperation[];
  undo: VideoEditorOperation[];
};

export function useVideoEditor(projectId: string) {
  const [initialWorkspacePreferences] = useState(() =>
    loadVideoEditorWorkspacePreferences(projectId),
  );
  const client = useQueryClient();
  const project = useQuery({
    queryKey: videoEditorQueryKeys.project(projectId),
    queryFn: () => getVideoEditorProject(projectId),
  });
  const timeline = useQuery({
    queryKey: videoEditorQueryKeys.timeline(projectId),
    queryFn: () => getVideoEditorTimeline(projectId),
  });
  const assets = useQuery({
    queryKey: videoEditorQueryKeys.assets(projectId),
    queryFn: () => listVideoEditorAssets(projectId),
    refetchInterval: (query) =>
      query.state.data?.items.some((asset) =>
        ["queued", "processing"].includes(asset.processingStatus),
      )
        ? 1000
        : false,
  });
  const tasks = useQuery({
    queryKey: videoEditorQueryKeys.renders(projectId),
    queryFn: () => listVideoEditorRenders(projectId),
    refetchInterval: 1200,
  });
  const [selectedClipId, setSelectedClipId] = useState<string | undefined>(
    initialWorkspacePreferences.selectedClipIds.at(-1),
  );
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>(
    initialWorkspacePreferences.selectedClipIds,
  );
  const [playheadUs, setPlayheadState] = useState(
    initialWorkspacePreferences.playheadUs,
  );
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(initialWorkspacePreferences.zoom);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(
    initialWorkspacePreferences.timelineScrollLeft,
  );
  const [timelineScrollTop, setTimelineScrollTop] = useState(
    initialWorkspacePreferences.timelineScrollTop ?? 0,
  );
  const [layout, setLayout] = useState(
    initialWorkspacePreferences.layout ?? { ...DEFAULT_EDITOR_LAYOUT },
  );
  const [preciseFrame, setPreciseFrame] = useState(
    initialWorkspacePreferences.preciseFrame,
  );
  const [snapEnabled, setSnapEnabled] = useState(
    initialWorkspacePreferences.snapEnabled,
  );
  const [notice, setNotice] = useState("");
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const clock = useRef({ startedAt: 0, startedUs: 0 });
  const fitPolicyMigrationRevision = useRef<number | undefined>(undefined);
  const playheadRef = useRef(initialWorkspacePreferences.playheadUs);
  const latestWorkspacePreferences = useRef<VideoEditorWorkspacePreferences>({
    ...initialWorkspacePreferences,
    selectedClipIds: [...initialWorkspacePreferences.selectedClipIds],
  });

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
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      ) {
        setNotice(
          "服务器版本已更新，已载入最新时间轴；本次操作未覆盖他人修改。",
        );
        void timeline.refetch();
      } else setNotice(error instanceof Error ? error.message : "保存失败");
    },
  });
  const renameMutation = useMutation({
    mutationFn: (title: string) => {
      if (!project.data) throw new Error("项目尚未就绪");
      return patchVideoEditorProject(project.data, { title });
    },
    onSuccess: (next) => {
      client.setQueryData(videoEditorQueryKeys.project(projectId), next);
      void client.invalidateQueries({
        queryKey: videoEditorQueryKeys.projects,
      });
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
  useEffect(() => {
    const current = timeline.data;
    if (!current || current.document.settings?.videoFitPolicyVersion === 1)
      return;
    if (fitPolicyMigrationRevision.current === current.revision) return;
    fitPolicyMigrationRevision.current = current.revision;
    const clips = (current.document.tracks ?? [])
      .flatMap((track) => track.clips ?? [])
      .filter((clip) => clip.kind === "video" && clip.fitMode !== "cover")
      .slice(0, 199);
    const operations: VideoEditorOperation[] = clips.map((clip) => ({
      type: "updateClip",
      clipId: clip.id,
      patch: { fitMode: "cover" },
    }));
    if (clips.length < 199) {
      operations.push({
        type: "updateSettings",
        patch: { videoFitPolicyVersion: 1 },
      });
    }
    void commit(operations).catch(() => {
      fitPolicyMigrationRevision.current = undefined;
    });
  }, [commit, timeline.data]);
  const undo = useCallback(async () => {
    const entry = undoStack.at(-1);
    if (!entry) return;
    await mutation.mutateAsync({ operations: entry.undo });
    setUndoStack((items) => items.slice(0, -1));
    setRedoStack((items) => [...items, entry]);
  }, [mutation, undoStack]);
  const redo = useCallback(async () => {
    const entry = redoStack.at(-1);
    if (!entry) return;
    await mutation.mutateAsync({ operations: entry.redo });
    setRedoStack((items) => items.slice(0, -1));
    setUndoStack((items) => [...items, entry]);
  }, [mutation, redoStack]);

  const durationUs = timelineDuration(timeline.data);
  const setPlayheadUs = useCallback(
    (update: number | ((value: number) => number)) => {
      const requested =
        typeof update === "function" ? update(playheadRef.current) : update;
      const next = Math.max(0, Math.min(durationUs, requested));
      playheadRef.current = next;
      setPlayheadState(next);
      if (playing) {
        clock.current = {
          startedAt: performance.now(),
          startedUs: next,
        };
      }
    },
    [durationUs, playing],
  );
  useEffect(() => {
    if (!playing) return;
    clock.current = {
      startedAt: performance.now(),
      startedUs: playheadRef.current,
    };
    let frame = 0;
    const tick = () => {
      const next =
        clock.current.startedUs +
        (performance.now() - clock.current.startedAt) * 1000;
      if (next >= durationUs) {
        playheadRef.current = durationUs;
        setPlayheadState(durationUs);
        setPlaying(false);
        return;
      }
      playheadRef.current = next;
      setPlayheadState(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationUs, playing]);
  useEffect(() => {
    if (!timeline.data) return;
    const validClipIds = new Set(
      (timeline.data.document.tracks ?? []).flatMap((track) =>
        (track.clips ?? []).map((clip) => clip.id),
      ),
    );
    setSelectedClipIds((current) => {
      const next = current.filter((clipId) => validClipIds.has(clipId));
      setSelectedClipId((selectedId) =>
        selectedId && validClipIds.has(selectedId) ? selectedId : next.at(-1),
      );
      return next.length === current.length ? current : next;
    });
    if (playheadRef.current > durationUs) {
      playheadRef.current = durationUs;
      setPlayheadState(durationUs);
    }
  }, [durationUs, timeline.data]);

  const moveSelectedClips = useCallback(
    (deltaUs: number) => {
      if (!timeline.data || !selectedClipIds.length) return;
      const clips = (timeline.data.document.tracks ?? []).flatMap(
        (track) => track.clips ?? [],
      );
      const movingIds = linkedClipIds(clips, selectedClipIds);
      const moving = clips.filter((clip) => movingIds.has(clip.id));
      const nextStarts = new Map(
        moving.map((clip) => [
          clip.id,
          Math.max(0, clip.timelineStartUs + deltaUs),
        ]),
      );
      if (
        moving.some(
          (clip) =>
            !canPlaceClip(
              clip,
              nextStarts.get(clip.id)!,
              clip.trackId,
              timeline.data!.document.tracks ?? [],
              movingIds,
            ),
        )
      ) {
        setNotice("该位置与其他片段重叠，无法移动");
        return;
      }
      const redo: VideoEditorOperation[] = moving.map((clip) => ({
        type: "moveClip",
        clipId: clip.id,
        trackId: clip.trackId,
        timelineStartUs: nextStarts.get(clip.id)!,
      }));
      const undo: VideoEditorOperation[] = moving.map((clip) => ({
        type: "moveClip",
        clipId: clip.id,
        trackId: clip.trackId,
        timelineStartUs: clip.timelineStartUs,
      }));
      void commit(redo, undo);
    },
    [commit, selectedClipIds, timeline.data],
  );

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof HTMLElement &&
          event.target.closest('[role="separator"], [aria-modal="true"]')) ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyZ") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyY") {
        event.preventDefault();
        void redo();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.code === "Home" || event.code === "End") {
        event.preventDefault();
        setPlaying(false);
        setPlayheadUs(event.code === "Home" ? 0 : durationUs);
        return;
      }
      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        const fps = timeline.data?.document.settings?.fps ?? 30;
        setPlaying(false);
        const direction = event.code === "ArrowLeft" ? -1 : 1;
        // Plain arrow keys seek the playhead. Use Alt+Arrow when a clip is
        // selected and it needs to be nudged, so selecting a clip does not
        // unexpectedly disable timeline scrubbing.
        if (event.altKey && selectedClipIds.length) {
          moveSelectedClips(
            direction * (event.shiftKey ? 1_000_000 : frameUs(fps)),
          );
        } else {
          setPlayheadUs((value) =>
            Math.max(0, Math.min(durationUs, value + direction * frameUs(fps))),
          );
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    durationUs,
    moveSelectedClips,
    selectedClipIds.length,
    setPlayheadUs,
    timeline.data,
    redo,
    undo,
  ]);

  const selected = (timeline.data?.document.tracks ?? [])
    .flatMap((track) => track.clips ?? [])
    .find((clip) => clip.id === selectedClipId);
  const selectClip = useCallback((clipId?: string, additive = false) => {
    setSelectedClipIds((current) => {
      if (!clipId) {
        setSelectedClipId(undefined);
        return [];
      }
      if (!additive) {
        setSelectedClipId(clipId);
        return [clipId];
      }
      const next = current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId];
      setSelectedClipId(next.at(-1));
      return next;
    });
  }, []);
  latestWorkspacePreferences.current = {
    version: 1,
    playheadUs,
    selectedClipIds,
    zoom,
    timelineScrollLeft,
    timelineScrollTop,
    layout,
    preciseFrame,
    snapEnabled,
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      storeVideoEditorWorkspacePreferences(
        projectId,
        latestWorkspacePreferences.current,
      );
    }, 150);
    return () => window.clearTimeout(timer);
  }, [
    playheadUs,
    preciseFrame,
    projectId,
    selectedClipIds,
    timelineScrollLeft,
    timelineScrollTop,
    layout,
    zoom,
    snapEnabled,
  ]);
  useEffect(() => {
    const persist = () => {
      storeVideoEditorWorkspacePreferences(
        projectId,
        latestWorkspacePreferences.current,
      );
    };
    window.addEventListener("pagehide", persist);
    return () => {
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, [projectId]);
  return {
    project,
    timeline,
    assets,
    tasks,
    selected,
    selectedClipId,
    setSelectedClipId: selectClip,
    selectedClipIds,
    selectClip,
    playheadUs,
    setPlayheadUs,
    playing,
    setPlaying,
    durationUs,
    zoom,
    setZoom,
    timelineScrollLeft,
    timelineScrollTop,
    layout,
    setTimelineScrollLeft,
    setTimelineScrollTop,
    setLayout,
    preciseFrame,
    setPreciseFrame,
    snapEnabled,
    setSnapEnabled,
    notice,
    setNotice,
    commit,
    undo,
    redo,
    canUndo: Boolean(undoStack.length),
    canRedo: Boolean(redoStack.length),
    saving: mutation.isPending,
    renameProject: renameMutation.mutateAsync,
    renaming: renameMutation.isPending,
  };
}
