import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAudioAnnotationDocument,
  getAudioAnnotationProject,
  getAudioAnnotationWaveform,
  putAudioAnnotationDocument,
  putAudioAnnotationWaveform,
} from "@features/audio-annotation/api";
import {
  duplicateSegmentForOverlap,
  languageLabel,
  loadPreferredDisplayLanguage,
  mergeWithNext,
  sameSegmentSpeakers,
  segmentSpeakerIds,
  segmentLanguageCodes,
  segmentSearchableText,
  PRIMARY_DISPLAY_LANGUAGE,
  storePreferredDisplayLanguage,
  splitSegment,
  WAVEFORM_ZOOM_RATIOS,
} from "@features/audio-annotation/model";
import type {
  AnnotationSnapshot,
  AudioAnnotationDocument,
  AudioAnnotationSegment,
  AudioAnnotationSpeaker,
} from "@features/audio-annotation/types";
import type { AudioWaveformHandle } from "@features/audio-annotation/AudioWaveform";
import { ApiError } from "@platform/api/client";
import { useSegmentTranscription } from "@features/audio-annotation/segmentTranscription";

function snapshot(document: AudioAnnotationDocument): AnnotationSnapshot {
  return {
    schema_version: "1.0",
    speakers: document.speakers,
    segments: document.segments,
  };
}

export function useAudioAnnotationEditorController({
  projectId,
  workspaceId,
  onBack,
  registerNavigationGuard,
}: {
  projectId: string;
  workspaceId: string;
  onBack: () => void;
  registerNavigationGuard: (
    guard: ((continueNavigation: () => void) => boolean) | null,
  ) => void;
}) {
  const queryClient = useQueryClient();
  const waveformRef = useRef<AudioWaveformHandle>(null);
  const documentRef = useRef<AudioAnnotationDocument | null>(null);
  const version = useRef(0);
  const textBase = useRef<AnnotationSnapshot | null>(null);
  const [document, setDocument] = useState<AudioAnnotationDocument | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewingSegmentId, setPreviewingSegmentId] = useState<string | null>(
    null,
  );
  const [rate, setRate] = useState("1");
  const [volume, setVolume] = useState(0.8);
  const [zoomRatio, setZoomRatio] = useState(1);
  const [waveformViewport, setWaveformViewport] = useState({
    startMs: 0,
    endMs: 0,
  });
  const [focusSelectionMode, setFocusSelectionMode] = useState(false);
  const [search, setSearch] = useState("");
  const [languageFilter, setLanguageFilter] = useState("all");
  const storedDisplayLanguage = useRef(
    loadPreferredDisplayLanguage(projectId, window.localStorage),
  );
  const [preferredDisplayLanguage, setPreferredDisplayLanguage] = useState(
    storedDisplayLanguage.current ?? PRIMARY_DISPLAY_LANGUAGE,
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [undoStack, setUndoStack] = useState<AnnotationSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationSnapshot[]>([]);
  const [speakerManager, setSpeakerManager] = useState(false);
  const [deleteSpeaker, setDeleteSpeaker] =
    useState<AudioAnnotationSpeaker | null>(null);
  const [deleteSpeakerReplacement, setDeleteSpeakerReplacement] =
    useState("unassigned");
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [textImportOpen, setTextImportOpen] = useState(false);
  const [textImportValue, setTextImportValue] = useState("");
  const [textImportError, setTextImportError] = useState("");
  dirtyRef.current = dirty;
  documentRef.current = document;

  const projectQuery = useQuery({
    queryKey: ["audio-annotation-project", projectId],
    queryFn: () => getAudioAnnotationProject(projectId),
  });
  const documentQuery = useQuery({
    queryKey: ["audio-annotation-document", projectId],
    queryFn: () => getAudioAnnotationDocument(projectId),
  });
  const waveformQuery = useQuery({
    queryKey: ["audio-annotation-waveform", projectId],
    queryFn: () => getAudioAnnotationWaveform(projectId),
  });
  const project = projectQuery.data;
  const waveform = waveformQuery.data;

  useEffect(() => {
    if (!document && documentQuery.data) {
      setDocument(documentQuery.data);
      setSelectedId(documentQuery.data.segments[0]?.id ?? null);
      if (!storedDisplayLanguage.current) {
        const initialLanguage = documentQuery.data.segments.some((segment) =>
          segmentLanguageCodes(segment).includes("zh"),
        )
          ? "zh"
          : PRIMARY_DISPLAY_LANGUAGE;
        storedDisplayLanguage.current = initialLanguage;
        setPreferredDisplayLanguage(initialLanguage);
        storePreferredDisplayLanguage(
          projectId,
          initialLanguage,
          window.localStorage,
        );
      }
    }
  }, [document, documentQuery.data, projectId]);

  const save = useMutation({
    mutationFn: async (input: {
      data: AnnotationSnapshot;
      revision: number;
      version: number;
    }) => ({
      saved: await putAudioAnnotationDocument(
        projectId,
        input.revision,
        input.data,
      ),
      version: input.version,
    }),
    onSuccess: ({ saved, version: savedVersion }) => {
      queryClient.setQueryData(["audio-annotation-document", projectId], saved);
      setDocument((current) =>
        current
          ? {
              ...current,
              revision: saved.revision,
              updated_at: saved.updated_at,
            }
          : current,
      );
      if (savedVersion === version.current) setDirty(false);
      setNotice("");
      void queryClient.invalidateQueries({
        queryKey: ["audio-annotation-project", projectId],
      });
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.problem.code === "revision_conflict"
      )
        setConflict(true);
      else
        setNotice(error instanceof Error ? error.message : "保存失败，请重试");
    },
  });

  const flushSave = useCallback(() => {
    if (!document || !dirty || conflict || save.isPending) return;
    save.mutate({
      data: snapshot(document),
      revision: document.revision,
      version: version.current,
    });
  }, [conflict, dirty, document, save]);

  useEffect(() => {
    if (!dirty || conflict || save.isPending) return;
    const timer = window.setTimeout(flushSave, 800);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, document, flushSave, save.isPending]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    registerNavigationGuard((continueNavigation) => {
      if (!dirtyRef.current) return false;
      setPendingNavigation(() => continueNavigation);
      return true;
    });
    return () => registerNavigationGuard(null);
  }, [registerNavigationGuard]);

  const applySnapshot = (next: AnnotationSnapshot, record = true) => {
    if (!document) return;
    if (record) {
      setUndoStack((current) => [...current, snapshot(document)].slice(-100));
      setRedoStack([]);
    }
    version.current += 1;
    setDocument({ ...document, ...next });
    setDirty(true);
    setNotice("");
  };

  const mutateSegments = (segments: AudioAnnotationSegment[] | null) => {
    if (document && segments)
      applySnapshot({ ...snapshot(document), segments });
  };

  const selected =
    document?.segments.find((segment) => segment.id === selectedId) ?? null;
  const selectedIndex =
    document?.segments.findIndex((segment) => segment.id === selectedId) ?? -1;
  const nextSegment =
    selectedIndex >= 0 ? document?.segments[selectedIndex + 1] : undefined;
  const previousSegment =
    selectedIndex > 0 ? document?.segments[selectedIndex - 1] : undefined;
  const snappedToPrevious =
    Boolean(previousSegment && selected) &&
    previousSegment!.end_ms === selected!.start_ms;
  const snappedToNext =
    Boolean(nextSegment && selected) &&
    nextSegment!.start_ms === selected!.end_ms;
  const overlapsPrevious =
    Boolean(previousSegment && selected) &&
    previousSegment!.end_ms > selected!.start_ms;
  const overlapsNext =
    Boolean(nextSegment && selected) &&
    nextSegment!.start_ms < selected!.end_ms;
  const canSnapToPrevious =
    Boolean(previousSegment && selected) &&
    !snappedToPrevious &&
    !overlapsPrevious;
  const canSnapToNext =
    Boolean(nextSegment && selected) && !snappedToNext && !overlapsNext;
  const speakerById = useMemo(
    () =>
      new Map(document?.speakers.map((speaker) => [speaker.id, speaker]) ?? []),
    [document?.speakers],
  );
  const visibleSegments = useMemo(() => {
    if (!document) return [];
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    return document.segments.filter((segment) => {
      if (statusFilter !== "all" && segment.status !== statusFilter)
        return false;
      const languages = segmentLanguageCodes(segment);
      if (
        languageFilter !== "all" &&
        (languageFilter === "unlabeled"
          ? languages.length > 0
          : !languages.includes(languageFilter))
      )
        return false;
      const speaker =
        segmentSpeakerIds(segment)
          .map((speakerId) => speakerById.get(speakerId)?.name)
          .filter(Boolean)
          .join(" ") || "未指定";
      return (
        !needle ||
        `${speaker} ${segment.emotion ?? ""} ${segmentSearchableText(segment)} ${languages
          .map(languageLabel)
          .join(" ")}`
          .toLocaleLowerCase("zh-CN")
          .includes(needle)
      );
    });
  }, [document, languageFilter, search, speakerById, statusFilter]);

  const undo = () => {
    if (!document || !undoStack.length) return;
    const previous = undoStack.at(-1)!;
    setRedoStack((current) => [...current, snapshot(document)].slice(-100));
    setUndoStack((current) => current.slice(0, -1));
    applySnapshot(previous, false);
  };
  const redo = () => {
    if (!document || !redoStack.length) return;
    const next = redoStack.at(-1)!;
    setUndoStack((current) => [...current, snapshot(document)].slice(-100));
    setRedoStack((current) => current.slice(0, -1));
    applySnapshot(next, false);
  };

  const doSplit = () => {
    if (!document || !selected) return;
    const next = splitSegment(document.segments, selected.id, currentMs);
    if (!next) {
      setNotice("播放位置需要距离片段边界至少 100 毫秒");
      return;
    }
    mutateSegments(next);
  };
  const addOverlappingSegment = () => {
    if (!document || !selected) return;
    const id = crypto.randomUUID();
    mutateSegments(
      duplicateSegmentForOverlap(document.segments, selected.id, () => id),
    );
    setSelectedId(id);
  };
  const doMerge = () => {
    if (!document || !selected || !nextSegment) return;
    if (
      segmentSpeakerIds(selected).length &&
      segmentSpeakerIds(nextSegment).length &&
      !sameSegmentSpeakers(selected, nextSegment)
    ) {
      setConfirmMerge(true);
      return;
    }
    mutateSegments(mergeWithNext(document.segments, selected.id));
  };

  const toggleSelectedPreview = () => {
    if (!selected) return;
    if (playing && previewingSegmentId === selected.id) {
      waveformRef.current?.pause();
      setPreviewingSegmentId(null);
      return;
    }
    setPreviewingSegmentId(selected.id);
    waveformRef.current?.playRange(selected.start_ms, selected.end_ms);
  };

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable=true]")) return;
      if (event.key === " ") {
        event.preventDefault();
        waveformRef.current?.playPause();
      } else if (event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        doSplit();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "z"
      ) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === "Escape") {
        setFocusSelectionMode(false);
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  });

  const updateSelected = (
    changes: Partial<AudioAnnotationSegment>,
    record = true,
  ) => {
    if (!document || !selected) return;
    const segments = document.segments.map((segment) =>
      segment.id === selected.id ? { ...segment, ...changes } : segment,
    );
    if (record) mutateSegments(segments);
    else {
      version.current += 1;
      setDocument({ ...document, segments });
      setDirty(true);
    }
  };

  const segmentTranscription = useSegmentTranscription({
    projectId,
    workspaceId,
    documentRef,
    selected,
    conflict,
    waveformRef,
    version,
    setDocument,
    setUndoStack,
    setRedoStack,
    setDirty,
    setNotice,
  });

  const savePeaks = useMutation({
    mutationFn: (peaks: number[][]) =>
      putAudioAnnotationWaveform(projectId, waveform!, peaks),
    onSuccess: () => void waveformQuery.refetch(),
    onError: () => setNotice("波形缓存保存失败，下次打开时会重新生成。"),
  });

  const reloadServer = async () => {
    const result = await documentQuery.refetch();
    if (!result.data) return;
    setDocument(result.data);
    setSelectedId(result.data.segments[0]?.id ?? null);
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    setConflict(false);
    version.current += 1;
  };

  if (projectQuery.isError || documentQuery.isError || waveformQuery.isError) {
    return { status: "error" as const, onBack };
  }
  if (
    projectQuery.isLoading ||
    documentQuery.isLoading ||
    waveformQuery.isLoading ||
    !project ||
    !document ||
    !waveform
  ) {
    return { status: "loading" as const };
  }

  const saveLabel = conflict
    ? "检测到版本冲突"
    : save.isPending
      ? "保存中…"
      : dirty
        ? "等待保存"
        : "已自动保存";
  const viewportDurationMs = project.duration_ms / zoomRatio;
  const maxViewportStartMs = Math.max(
    0,
    project.duration_ms - viewportDurationMs,
  );
  const zoomCenterMs =
    waveformViewport.endMs > waveformViewport.startMs
      ? (waveformViewport.startMs + waveformViewport.endMs) / 2
      : currentMs;
  const applyZoom = (nextRatio: number, anchorMs = zoomCenterMs) => {
    const next = Math.min(
      WAVEFORM_ZOOM_RATIOS.at(-1)!,
      Math.max(WAVEFORM_ZOOM_RATIOS[0], nextRatio),
    );
    setZoomRatio(next);
    waveformRef.current?.zoom(next, anchorMs);
  };

  return {
    status: "ready" as const,
    addOverlappingSegment,
    applySnapshot,
    applyZoom,
    canSnapToNext,
    canSnapToPrevious,
    confirmLeave,
    confirmMerge,
    conflict,
    currentMs,
    deleteSpeaker,
    deleteSpeakerReplacement,
    dirty,
    doMerge,
    doSplit,
    document,
    exportOpen,
    flushSave,
    focusSelectionMode,
    languageFilter,
    maxViewportStartMs,
    mutateSegments,
    nextSegment,
    notice,
    onBack,
    overlapsNext,
    overlapsPrevious,
    pendingNavigation,
    playing,
    preferredDisplayLanguage,
    previewingSegmentId,
    previousSegment,
    project,
    projectId,
    rate,
    redo,
    redoStack,
    registerNavigationGuard,
    reloadServer,
    save,
    saveLabel,
    savePeaks,
    search,
    segmentTranscription,
    selected,
    selectedId,
    selectedIndex,
    setConfirmLeave,
    setConfirmMerge,
    setCurrentMs,
    setDeleteSpeaker,
    setDeleteSpeakerReplacement,
    setDirty,
    setExportOpen,
    setFocusSelectionMode,
    setLanguageFilter,
    setNotice,
    setPendingNavigation,
    setPlaying,
    setPreferredDisplayLanguage,
    setPreviewingSegmentId,
    setRate,
    setSearch,
    setSelectedId,
    setSpeakerManager,
    setStatusFilter,
    setTextImportError,
    setTextImportOpen,
    setTextImportValue,
    setUndoStack,
    setVolume,
    setWaveformViewport,
    setZoomRatio,
    snappedToNext,
    snappedToPrevious,
    speakerById,
    speakerManager,
    statusFilter,
    textBase,
    textImportError,
    textImportOpen,
    textImportValue,
    toggleSelectedPreview,
    undo,
    undoStack,
    updateSelected,
    visibleSegments,
    volume,
    waveform,
    waveformRef,
    waveformViewport,
    zoomRatio,
  };
}

export type AudioAnnotationEditorController = Extract<
  ReturnType<typeof useAudioAnnotationEditorController>,
  { status: "ready" }
>;
