import type { TransformDraft } from "./transformModel";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { DEFAULT_EDITOR_LAYOUT } from "./editorLayout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@platform/api/client";
import {
  applyVideoEditorOperations,
  getVideoEditorProject,
  getVideoEditorTimeline,
  listVideoEditorAssets,
  patchVideoEditorProject,
} from "./api";
import type { VideoEditorClip, VideoEditorOperation } from "./types";
import {
  pasteClipsOperations,
  snapshotClipsForClipboard,
  type ClipClipboardSnapshot,
} from "./clipClipboard";
import { frameUs, timelineDuration } from "./editorModel";
import {
  BATCH_OPS_LIMIT,
  buildBatchClipOperations,
  type BatchClipPatch,
} from "./batchClipPatch";
import { canPlaceClip, linkedClipIds } from "./timelineSnap";
import { videoEditorQueryKeys } from "./queryKeys";
import {
  TimelineSaveQueue,
  refreshUndo,
  type TimelineEditBuilder,
} from "./timelineSaveQueue";
import {
  loadVideoEditorWorkspacePreferences,
  storeVideoEditorWorkspacePreferences,
  type VideoEditorWorkspacePreferences,
} from "./workspacePreferences";

export function useVideoEditor(projectId: string) {
  const canWrite = useWorkspacePermission("content.write");
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
  const [speedRippleEnabled, setSpeedRippleEnabled] = useState(
    initialWorkspacePreferences.speedRippleEnabled ?? true,
  );
  const [transformDraft, setTransformDraft] = useState<TransformDraft>();
  const [notice, setNotice] = useState("");
  const [, redrawQueue] = useState(0);
  const [clipboard, setClipboard] = useState<ClipClipboardSnapshot>();
  const clock = useRef({ startedAt: 0, startedUs: 0 });
  const fitPolicyMigrationRevision = useRef<number | undefined>(undefined);
  const playheadRef = useRef(initialWorkspacePreferences.playheadUs);
  const latestWorkspacePreferences = useRef<VideoEditorWorkspacePreferences>({
    ...initialWorkspacePreferences,
    selectedClipIds: [...initialWorkspacePreferences.selectedClipIds],
  });

  const saveQueue = useMemo(
    () =>
      new TimelineSaveQueue({
        read: () =>
          client.getQueryData(videoEditorQueryKeys.timeline(projectId)),
        write: (revision, operations) =>
          applyVideoEditorOperations(projectId, revision, operations),
        saved: (next) => {
          client.setQueryData(videoEditorQueryKeys.timeline(projectId), next);
          setNotice("已自动保存");
        },
        failed: (error) => {
          setNotice(
            error instanceof ApiError &&
              error.problem.code === "revision_conflict"
              ? "服务器版本已更新；未保存操作已暂停，请确认放弃后重新编辑。"
              : "保存失败；未保存操作已暂停，请核对服务器状态后重新编辑。",
          );
          void client.refetchQueries({
            queryKey: videoEditorQueryKeys.timeline(projectId),
          });
        },
        changed: () => redrawQueue((value) => value + 1),
      }),
    [client, projectId],
  );
  useEffect(() => saveQueue.attach(), [saveQueue]);
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
    (
      redo: VideoEditorOperation[] | TimelineEditBuilder,
      undo: VideoEditorOperation[] = [],
    ) => {
      const preparedUndo = structuredClone(undo);
      const preparedRedo =
        typeof redo === "function" ? redo : structuredClone(redo);
      return saveQueue.enqueue(
        "edit",
        typeof preparedRedo === "function"
          ? preparedRedo
          : (current) => ({
              redo: preparedRedo,
              undo: refreshUndo(current, preparedUndo),
            }),
      );
    },
    [saveQueue],
  );
  useEffect(() => {
    if (!canWrite) return;
    const current = timeline.data;
    if (!current || current.document.settings?.videoFitPolicyVersion === 1)
      return;
    if (fitPolicyMigrationRevision.current === current.revision) return;
    fitPolicyMigrationRevision.current = current.revision;
    void commit((latest) => {
      if (latest.document.settings?.videoFitPolicyVersion === 1)
        return { redo: [], undo: [] };
      const clips = (latest.document.tracks ?? [])
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
      return { redo: operations, undo: [] };
    }).catch(() => {});
  }, [canWrite, commit, timeline.data]);
  const undo = useCallback(() => saveQueue.enqueue("undo"), [saveQueue]);
  const redo = useCallback(() => saveQueue.enqueue("redo"), [saveQueue]);
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
      if (!selectedClipIds.length) return;
      void commit((current) => {
        const clips = (current.document.tracks ?? []).flatMap(
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
                current.document.tracks ?? [],
                movingIds,
              ),
          )
        ) {
          setNotice("该位置与其他片段重叠，无法移动");
          return { redo: [], undo: [] };
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
        return { redo, undo };
      });
    },
    [commit, selectedClipIds],
  );

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

  const allClips = useCallback(
    () =>
      (timeline.data?.document.tracks ?? []).flatMap(
        (track) => track.clips ?? [],
      ),
    [timeline.data],
  );

  const copyClip = useCallback(
    (clipOrClips?: VideoEditorClip | VideoEditorClip[]) => {
      const targets = clipOrClips
        ? Array.isArray(clipOrClips)
          ? clipOrClips
          : [clipOrClips]
        : allClips().filter((clip) => selectedClipIds.includes(clip.id));
      if (!targets.length) return false;
      if (targets.length > BATCH_OPS_LIMIT) {
        setNotice(`一次最多复制 ${BATCH_OPS_LIMIT} 个片段`);
        return false;
      }
      setClipboard(snapshotClipsForClipboard(targets));
      setNotice(
        targets.length > 1 ? `已复制 ${targets.length} 个片段` : "已复制片段",
      );
      return true;
    },
    [allClips, selectedClipIds],
  );

  const copySelectedClip = useCallback(() => copyClip(), [copyClip]);

  const pasteClipboardClip = useCallback(() => {
    if (!clipboard?.length || !timeline.data) return false;
    if (clipboard.length > BATCH_OPS_LIMIT) {
      setNotice(`一次最多粘贴 ${BATCH_OPS_LIMIT} 个片段`);
      return false;
    }
    const cursor = playheadRef.current;
    let newClipIds: string[] = [];
    void commit((current) => {
      const result = pasteClipsOperations({
        snapshot: clipboard,
        tracks: current.document.tracks ?? [],
        playheadUs: cursor,
        fps: current.document.settings?.fps ?? 30,
      });
      if ("error" in result) {
        setNotice(result.error);
        return { redo: [], undo: [] };
      }
      newClipIds = result.newClipIds;
      return result;
    })
      .then(() => {
        const [first, ...rest] = newClipIds;
        if (!first) return;
        selectClip(first);
        for (const id of rest) selectClip(id, true);
      })
      .catch(() => {});
    return true;
  }, [clipboard, commit, selectClip, timeline.data]);

  const patchSelectedClips = useCallback(
    async (patch: BatchClipPatch) => {
      let result: ReturnType<typeof buildBatchClipOperations> | undefined;
      await commit((current) => {
        const clips = (current.document.tracks ?? [])
          .flatMap((track) => track.clips ?? [])
          .filter((clip) => selectedClipIds.includes(clip.id));
        result = buildBatchClipOperations(clips, patch);
        return result;
      });
      return result!;
    },
    [commit, selectedClipIds],
  );

  useEffect(() => {
    setClipboard(undefined);
  }, [projectId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            '[role="separator"], [role="switch"], [role="checkbox"], [aria-modal="true"]',
          )) ||
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
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyC") {
        if (!canWrite || !selectedClipIds.length) return;
        event.preventDefault();
        copyClip();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyV") {
        if (!canWrite || !clipboard?.length) return;
        event.preventDefault();
        pasteClipboardClip();
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
    canWrite,
    clipboard,
    copyClip,
    durationUs,
    moveSelectedClips,
    pasteClipboardClip,
    selectedClipIds.length,
    setPlayheadUs,
    timeline.data,
    redo,
    undo,
  ]);
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
    speedRippleEnabled,
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
    speedRippleEnabled,
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
    transformDraft,
    setTransformDraft,
    project,
    timeline,
    assets,
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
    speedRippleEnabled,
    setSnapEnabled,
    setSpeedRippleEnabled,
    notice,
    setNotice,
    hasClipboard: Boolean(clipboard?.length),
    copySelectedClip,
    copyClip,
    pasteClipboardClip,
    patchSelectedClips,
    commit,
    undo,
    redo,
    canUndo: saveQueue.canUndo,
    canRedo: saveQueue.canRedo,
    saving: saveQueue.unsaved,
    saveBusy: saveQueue.busy,
    failedSaves: saveQueue.failedCount,
    failedOperations: saveQueue.failedOperations,
    discardFailedSaves: () => {
      const discarded = saveQueue.discard();
      if (discarded) setNotice("已放弃未保存操作，请按服务器快照重新编辑");
      return discarded;
    },
    renameProject: renameMutation.mutateAsync,
    renaming: renameMutation.isPending,
  };
}
