import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Merge,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Search,
  Trash2,
  Undo2,
  Users,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  getGalgameStoryDocument,
  getGalgameWorkshopProjects,
  type GalgameWorkshopProject,
} from "@features/galgame-workshop";
import {
  getAudioAnnotationDocument,
  getAudioAnnotationProject,
  getAudioAnnotationWaveform,
  putAudioAnnotationDocument,
  putAudioAnnotationWaveform,
} from "@features/audio-annotation/api";
import {
  ANNOTATION_LANGUAGES,
  createSegment,
  duplicateSegmentForOverlap,
  formatDuration,
  formatTimestamp,
  languageColor,
  languageLabel,
  mergeImportedSpeakers,
  mergeWithNext,
  parseTimestamp,
  segmentLanguageCodes,
  segmentSearchableText,
  SPEAKER_COLORS,
  splitSegment,
  type ImportedAudioAnnotationSpeaker,
  updateSegmentBounds,
  waveformFocusZoom,
  WAVEFORM_ZOOM_RATIOS,
} from "@features/audio-annotation/model";
import { LanguageAnnotationEditor } from "@features/audio-annotation/LanguageAnnotationEditor";
import type {
  AnnotationSnapshot,
  AudioAnnotationDocument,
  AudioAnnotationSegment,
  AudioAnnotationSpeaker,
} from "@features/audio-annotation/types";
import {
  AudioWaveform,
  type AudioWaveformHandle,
} from "@features/audio-annotation/AudioWaveform";
import { ApiError } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useSegmentTranscription } from "@features/audio-annotation/segmentTranscription";
import { SegmentTranscriptionDialogs } from "@features/audio-annotation/SegmentTranscriptionDialogs";
import { AudioAnnotationExportDialog } from "@features/audio-annotation/AudioAnnotationExportDialog";
import "@features/audio-annotation/audio-annotation.css";

const EMPTY_GALGAME_PROJECTS: GalgameWorkshopProject[] = [];

function snapshot(document: AudioAnnotationDocument): AnnotationSnapshot {
  return {
    schema_version: "1.0",
    speakers: document.speakers,
    segments: document.segments,
  };
}

function SpeakerManager({
  open,
  projectTitle,
  speakers,
  onChange,
  onImport,
  onDelete,
  onClose,
}: {
  open: boolean;
  projectTitle: string;
  speakers: AudioAnnotationSpeaker[];
  onChange: (speakers: AudioAnnotationSpeaker[]) => void;
  onImport: (speakers: ImportedAudioAnnotationSpeaker[]) => number;
  onDelete: (speaker: AudioAnnotationSpeaker) => void;
  onClose: () => void;
}) {
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["galgame-speaker-import-projects"],
    queryFn: getGalgameWorkshopProjects,
    enabled: open,
  });
  const projects = projectsQuery.data?.items ?? EMPTY_GALGAME_PROJECTS;
  const matchingProject = useMemo(() => {
    const normalizedTitle = projectTitle.trim().toLocaleLowerCase("zh-CN");
    if (!normalizedTitle) return undefined;
    return projects.find((project) => {
      const title = project.title.trim().toLocaleLowerCase("zh-CN");
      return (
        title &&
        (normalizedTitle.includes(title) || title.includes(normalizedTitle))
      );
    });
  }, [projectTitle, projects]);

  useEffect(() => {
    if (!open) {
      setSourceProjectId("");
      setImportNotice("");
      return;
    }
    if (!sourceProjectId && projects.length)
      setSourceProjectId(matchingProject?.id ?? projects[0]!.id);
  }, [matchingProject, open, projects, sourceProjectId]);

  const storyQuery = useQuery({
    queryKey: ["galgame-speaker-import-story", sourceProjectId],
    queryFn: () => getGalgameStoryDocument(sourceProjectId),
    enabled: open && Boolean(sourceProjectId),
  });

  const importCharacters = () => {
    const characters = storyQuery.data?.document.characters ?? [];
    if (!characters.length) {
      setImportNotice("这个 Galgame 工程还没有角色。");
      return;
    }
    const addedCount = onImport(
      characters.map((character) => ({
        id: character.id,
        name: character.name,
        color: character.themeColor,
      })),
    );
    setImportNotice(
      addedCount
        ? `已加入 ${addedCount} 个角色名，重复名称会自动跳过。`
        : "没有新增角色名，现有名单已包含这些角色。",
    );
  };

  const add = () => {
    if (speakers.length >= 64) return;
    const used = new Set(
      speakers.map((speaker) => speaker.name.toLocaleLowerCase("zh-CN")),
    );
    let index = speakers.length + 1;
    while (used.has(`说话人 ${index}`.toLocaleLowerCase("zh-CN"))) index += 1;
    onChange([
      ...speakers,
      {
        id: crypto.randomUUID(),
        name: `说话人 ${index}`,
        color: SPEAKER_COLORS[speakers.length % SPEAKER_COLORS.length]!,
      },
    ]);
  };
  const rename = (speaker: AudioAnnotationSpeaker, name: string) => {
    const normalized = name.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return;
    if (
      speakers.some(
        (item) =>
          item.id !== speaker.id &&
          item.name.trim().toLocaleLowerCase("zh-CN") === normalized,
      )
    )
      return;
    onChange(
      speakers.map((item) =>
        item.id === speaker.id ? { ...item, name } : item,
      ),
    );
  };
  if (!open) return null;
  return (
    <div className="annotation-modal-backdrop" role="presentation">
      <section
        className="annotation-modal annotation-speaker-modal"
        role="dialog"
        aria-modal="true"
        aria-label="管理说话人"
      >
        <header>
          <div>
            <span className="eyebrow">任务内名单</span>
            <h2>管理说话人</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <section className="annotation-speaker-import">
          <div>
            <strong>从 Galgame 工坊导入角色</strong>
            <small>沿用角色名和主题色，导入后仍可继续编辑。</small>
          </div>
          {projectsQuery.isLoading ? (
            <p>正在读取 Galgame 工程…</p>
          ) : projects.length ? (
            <div className="annotation-speaker-import-controls">
              <CustomSelect
                ariaLabel="角色来源工程"
                value={sourceProjectId}
                options={projects.map((project: GalgameWorkshopProject) => ({
                  value: project.id,
                  label: project.title,
                  description:
                    project.status === "completed" ? "已完成" : "草稿",
                }))}
                onChange={(value) => {
                  setSourceProjectId(value);
                  setImportNotice("");
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={storyQuery.isLoading || !storyQuery.data}
                onClick={importCharacters}
              >
                <Users aria-hidden />
                {storyQuery.isLoading ? "读取角色…" : "导入角色名"}
              </button>
            </div>
          ) : (
            <p>暂无可导入的 Galgame 工程。</p>
          )}
          {storyQuery.isError ? <p>角色读取失败，请稍后重试。</p> : null}
          {importNotice ? <small role="status">{importNotice}</small> : null}
        </section>
        <div className="annotation-speaker-list">
          {speakers.map((speaker, index) => (
            <div key={speaker.id}>
              <CustomColorPicker
                compact
                value={speaker.color}
                ariaLabel={`${speaker.name}颜色`}
                colors={SPEAKER_COLORS}
                onChange={(color) =>
                  onChange(
                    speakers.map((item) =>
                      item.id === speaker.id ? { ...item, color } : item,
                    ),
                  )
                }
              />
              <input
                aria-label={`说话人 ${index + 1} 名称`}
                value={speaker.name}
                maxLength={80}
                onChange={(event) => rename(speaker, event.target.value)}
              />
              <button
                type="button"
                aria-label={`删除说话人${speaker.name}`}
                onClick={() => onDelete(speaker)}
              >
                <Trash2 aria-hidden />
              </button>
            </div>
          ))}
          {!speakers.length ? (
            <p>还没有说话人。添加后即可分配给片段。</p>
          ) : null}
        </div>
        <footer>
          <button
            type="button"
            className="btn"
            disabled={speakers.length >= 64}
            onClick={add}
          >
            <Plus aria-hidden /> 添加说话人
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}

export function AudioAnnotationEditorPage({
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
    }
  }, [document, documentQuery.data]);

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
      const speaker = segment.speaker_id
        ? (speakerById.get(segment.speaker_id)?.name ?? "")
        : "未指定";
      return (
        !needle ||
        `${speaker} ${segmentSearchableText(segment)} ${languages
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
      selected.speaker_id &&
      nextSegment.speaker_id &&
      selected.speaker_id !== nextSegment.speaker_id
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
    return (
      <section className="page annotation-editor-page">
        <p className="annotation-error">任务加载失败，请返回后重试。</p>
        <button type="button" className="btn" onClick={onBack}>
          返回任务列表
        </button>
      </section>
    );
  }
  if (
    projectQuery.isLoading ||
    documentQuery.isLoading ||
    waveformQuery.isLoading ||
    !project ||
    !document ||
    !waveform
  ) {
    return (
      <section className="page annotation-editor-page">
        <div className="page-loading">正在加载录音标注任务…</div>
      </section>
    );
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

  return (
    <section className="page annotation-editor-page">
      <header className="annotation-editor-header">
        <div className="annotation-editor-title">
          <button
            type="button"
            className="annotation-back-square"
            aria-label="返回任务列表"
            onClick={() => (dirty ? setConfirmLeave(true) : onBack())}
          >
            <ArrowLeft aria-hidden />
          </button>
          <div>
            <h1>{project.title}</h1>
            <p>
              {project.original_filename} · {saveLabel}
            </p>
          </div>
        </div>
        <div className="annotation-editor-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setExportOpen(true)}
          >
            <Download aria-hidden /> 导出标注
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!dirty || save.isPending || conflict}
            onClick={flushSave}
          >
            <Save aria-hidden /> 保存
          </button>
        </div>
      </header>
      {notice ? (
        <p className="annotation-error" role="alert">
          {notice}
        </p>
      ) : null}
      {conflict ? (
        <div className="annotation-conflict" role="alert">
          <span>服务器上的标注已被其他操作更新。本地内容不会被自动覆盖。</span>
          <button type="button" onClick={() => setExportOpen(true)}>
            导出本地 JSON
          </button>
          <button type="button" onClick={() => void reloadServer()}>
            加载服务器版本
          </button>
        </div>
      ) : null}

      <div className="annotation-editor-grid">
        <div className="annotation-editor-main">
          <section className="card annotation-waveform-card">
            <header className="annotation-waveform-meta">
              <div>
                <small>音频总时长</small>
                <strong>{formatDuration(project.duration_ms)}</strong>
              </div>
              <div>
                <small>文件信息</small>
                <span>
                  {project.mime_type.replace("audio/", "").toUpperCase()} ·{" "}
                  {(project.byte_size / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
              <div className="annotation-waveform-tools">
                <div className="annotation-zoom-controls">
                  <button
                    type="button"
                    aria-label="缩小波形"
                    disabled={zoomRatio <= 1}
                    onClick={() => applyZoom(zoomRatio / 2)}
                  >
                    <ZoomOut aria-hidden />
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    step="0.05"
                    value={Math.log2(zoomRatio)}
                    aria-label="波形缩放比例"
                    onChange={(event) =>
                      applyZoom(2 ** Number(event.target.value))
                    }
                  />
                  <span>{zoomRatio.toFixed(zoomRatio < 10 ? 1 : 0)}×</span>
                  <button
                    type="button"
                    aria-label="放大波形"
                    disabled={zoomRatio >= WAVEFORM_ZOOM_RATIOS.at(-1)!}
                    onClick={() => applyZoom(zoomRatio * 2)}
                  >
                    <ZoomIn aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  className="annotation-view-action"
                  disabled={zoomRatio === 1}
                  onClick={() => applyZoom(1, 0)}
                >
                  适应全长
                </button>
                <button
                  type="button"
                  className="annotation-view-action"
                  disabled={!selected}
                  onClick={() => {
                    if (!selected) return;
                    const next = waveformFocusZoom(
                      project.duration_ms,
                      selected.start_ms,
                      selected.end_ms,
                    );
                    applyZoom(next, (selected.start_ms + selected.end_ms) / 2);
                  }}
                >
                  聚焦所选
                </button>
                <button
                  type="button"
                  className="annotation-view-action"
                  aria-pressed={focusSelectionMode}
                  onClick={() => {
                    const next = !focusSelectionMode;
                    setFocusSelectionMode(next);
                    if (next) applyZoom(1, 0);
                  }}
                >
                  {focusSelectionMode ? "取消框选" : "框选放大"}
                </button>
              </div>
            </header>
            <AudioWaveform
              ref={waveformRef}
              assetId={project.asset_id}
              durationMs={project.duration_ms}
              peaks={waveform.peaks}
              segments={document.segments}
              speakers={document.speakers}
              selectedId={selectedId}
              focusSelectionMode={focusSelectionMode}
              onSelect={(segmentId) => {
                if (previewingSegmentId) waveformRef.current?.pause();
                setPreviewingSegmentId(null);
                setSelectedId(segmentId);
              }}
              onUpdate={(id, start, end) =>
                mutateSegments(
                  updateSegmentBounds(
                    document.segments,
                    id,
                    start,
                    end,
                    project.duration_ms,
                  ),
                )
              }
              onCreate={(start, end) =>
                mutateSegments(createSegment(document.segments, start, end))
              }
              onTime={setCurrentMs}
              onPlayState={(nextPlaying) => {
                setPlaying(nextPlaying);
                if (!nextPlaying) setPreviewingSegmentId(null);
              }}
              onViewport={setWaveformViewport}
              onFocusRange={(startMs, endMs) => {
                const next = waveformFocusZoom(
                  project.duration_ms,
                  startMs,
                  endMs,
                );
                setFocusSelectionMode(false);
                setZoomRatio(next);
                waveformRef.current?.zoom(next, (startMs + endMs) / 2);
              }}
              onReadyPeaks={(peaks) => {
                if (!waveform.peaks.length && !savePeaks.isPending)
                  savePeaks.mutate(peaks);
              }}
              onAudioReady={segmentTranscription.setAudioReady}
              onError={setNotice}
            />
            <div className="annotation-waveform-navigator">
              <button
                type="button"
                aria-label="向左浏览波形"
                disabled={zoomRatio === 1 || waveformViewport.startMs <= 0}
                onClick={() => waveformRef.current?.panBy(-0.8)}
              >
                <ChevronLeft aria-hidden />
              </button>
              <label>
                <span>左右浏览</span>
                <input
                  type="range"
                  min="0"
                  max={maxViewportStartMs}
                  step="100"
                  value={Math.min(maxViewportStartMs, waveformViewport.startMs)}
                  aria-label="波形浏览位置"
                  disabled={zoomRatio === 1}
                  onChange={(event) =>
                    waveformRef.current?.scrollTo(Number(event.target.value))
                  }
                />
              </label>
              <button
                type="button"
                aria-label="向右浏览波形"
                disabled={
                  zoomRatio === 1 ||
                  waveformViewport.startMs >= maxViewportStartMs
                }
                onClick={() => waveformRef.current?.panBy(0.8)}
              >
                <ChevronRight aria-hidden />
              </button>
              <span className="annotation-viewport-time">
                当前窗口 {formatTimestamp(waveformViewport.startMs)} –{" "}
                {formatTimestamp(waveformViewport.endMs || project.duration_ms)}
              </span>
              <small>拖动滑杆，或在波形上横向滚动</small>
            </div>
            <div className="annotation-transport">
              <button
                type="button"
                className="annotation-play"
                aria-label={playing ? "暂停录音" : "播放录音"}
                onClick={() => waveformRef.current?.playPause()}
              >
                {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
              </button>
              <CustomSelect
                ariaLabel="播放速度"
                value={rate}
                options={[
                  { value: "0.5", label: "0.5×" },
                  { value: "0.75", label: "0.75×" },
                  { value: "1", label: "1.0×" },
                  { value: "1.25", label: "1.25×" },
                  { value: "1.5", label: "1.5×" },
                  { value: "2", label: "2.0×" },
                ]}
                onChange={(value) => {
                  setRate(value);
                  waveformRef.current?.setRate(Number(value));
                }}
              />
              <div className="annotation-playback-time">
                <strong>{formatTimestamp(currentMs)}</strong>
                <span>/ {formatTimestamp(project.duration_ms)}</span>
              </div>
              <label className="annotation-volume">
                <Volume2 aria-hidden />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  aria-label="录音音量"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setVolume(next);
                    waveformRef.current?.setVolume(next);
                  }}
                />
              </label>
              <div className="annotation-edit-actions">
                <button type="button" disabled={!selected} onClick={doSplit}>
                  <Scissors aria-hidden /> 在此切分
                </button>
                <button
                  type="button"
                  disabled={!selected}
                  onClick={addOverlappingSegment}
                >
                  <Plus aria-hidden /> 添加重叠片段
                </button>
                <button
                  type="button"
                  disabled={!selected || !nextSegment}
                  onClick={doMerge}
                >
                  <Merge aria-hidden /> 合并下一段
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={!selected}
                  onClick={() => {
                    if (!selected) return;
                    mutateSegments(
                      document.segments.filter(
                        (segment) => segment.id !== selected.id,
                      ),
                    );
                    setSelectedId(
                      nextSegment?.id ??
                        document.segments[selectedIndex - 1]?.id ??
                        null,
                    );
                  }}
                >
                  <Trash2 aria-hidden /> 删除片段
                </button>
              </div>
            </div>
          </section>

          <section className="card annotation-segment-table-card">
            <header>
              <label>
                <Search aria-hidden />
                <input
                  aria-label="搜索片段内容"
                  placeholder="搜索片段内容…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <CustomSelect
                ariaLabel="筛选片段语言"
                value={languageFilter}
                options={[
                  { value: "all", label: "全部语言" },
                  ...ANNOTATION_LANGUAGES.map((language) => ({
                    value: language.code,
                    label: language.label,
                  })),
                  { value: "unlabeled", label: "未标注语言" },
                ]}
                onChange={setLanguageFilter}
              />
              <CustomSelect
                ariaLabel="筛选片段状态"
                value={statusFilter}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "reviewed", label: "已校对" },
                  { value: "draft", label: "待校对" },
                ]}
                onChange={setStatusFilter}
              />
              <div className="annotation-history">
                <button
                  type="button"
                  aria-label="撤销"
                  disabled={!undoStack.length}
                  onClick={undo}
                >
                  <Undo2 aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="重做"
                  disabled={!redoStack.length}
                  onClick={redo}
                >
                  <Redo2 aria-hidden />
                </button>
              </div>
            </header>
            <div
              className="annotation-segment-table"
              role="table"
              aria-label="音频片段列表"
            >
              <div role="row" className="annotation-segment-head">
                <span>片段</span>
                <span>时间范围</span>
                <span>说话人</span>
                <span>语言</span>
                <span>内容</span>
                <span>状态</span>
              </div>
              {visibleSegments.map((segment) => {
                const index = document.segments.findIndex(
                  (item) => item.id === segment.id,
                );
                const speaker = segment.speaker_id
                  ? speakerById.get(segment.speaker_id)
                  : undefined;
                const languageCodes = segmentLanguageCodes(segment);
                return (
                  <button
                    type="button"
                    role="row"
                    key={segment.id}
                    className={selectedId === segment.id ? "selected" : ""}
                    onClick={() => {
                      if (previewingSegmentId) waveformRef.current?.pause();
                      setPreviewingSegmentId(null);
                      setSelectedId(segment.id);
                      waveformRef.current?.seekMs(segment.start_ms);
                    }}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>
                      {formatTimestamp(segment.start_ms)} –{" "}
                      {formatTimestamp(segment.end_ms)}
                    </span>
                    <span>
                      <i style={{ background: speaker?.color ?? "#8b9189" }} />
                      {speaker?.name ?? "未指定"}
                    </span>
                    <span className="annotation-language-badges">
                      {languageCodes.length ? (
                        languageCodes.map((code) => (
                          <i
                            key={code}
                            className={`language-${languageColor(code)}`}
                          >
                            {languageLabel(code)}
                          </i>
                        ))
                      ) : (
                        <em>未标注</em>
                      )}
                    </span>
                    <span>{segment.text || "（尚未填写内容）"}</span>
                    <span className={segment.status}>
                      {segment.status === "reviewed" ? "已校对" : "待校对"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="card annotation-inspector" aria-label="片段编辑器">
          {selected ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">当前选择</span>
                  <h2>片段 {String(selectedIndex + 1).padStart(2, "0")}</h2>
                </div>
                <span
                  style={{
                    background: selected.speaker_id
                      ? speakerById.get(selected.speaker_id)?.color
                      : "#8b9189",
                  }}
                />
              </header>
              <div className="annotation-mini-wave">
                <i />
                <button
                  type="button"
                  className="annotation-segment-preview"
                  aria-label={
                    playing && previewingSegmentId === selected.id
                      ? "暂停当前片段"
                      : "播放当前片段"
                  }
                  onClick={toggleSelectedPreview}
                >
                  {playing && previewingSegmentId === selected.id ? (
                    <Pause aria-hidden />
                  ) : (
                    <Play aria-hidden />
                  )}
                  <span>
                    {playing && previewingSegmentId === selected.id
                      ? "暂停"
                      : "试听片段"}
                  </span>
                </button>
                <span>
                  {formatTimestamp(selected.start_ms)} —{" "}
                  {formatTimestamp(selected.end_ms)}
                </span>
              </div>
              <div className="annotation-time-fields">
                <label className="annotation-time-field">
                  <span>开始</span>
                  <input
                    key={`${selected.id}-start-${selected.start_ms}`}
                    defaultValue={formatTimestamp(selected.start_ms)}
                    aria-label="片段开始时间"
                    onBlur={(event) => {
                      const parsed = parseTimestamp(event.target.value);
                      if (parsed !== null)
                        mutateSegments(
                          updateSegmentBounds(
                            document.segments,
                            selected.id,
                            parsed,
                            selected.end_ms,
                            project.duration_ms,
                          ),
                        );
                      else setNotice("开始时间格式应为 MM:SS.mmm");
                    }}
                  />
                </label>
                <span>—</span>
                <label className="annotation-time-field">
                  <span>结束</span>
                  <input
                    key={`${selected.id}-end-${selected.end_ms}`}
                    defaultValue={formatTimestamp(selected.end_ms)}
                    aria-label="片段结束时间"
                    onBlur={(event) => {
                      const parsed = parseTimestamp(event.target.value);
                      if (parsed !== null)
                        mutateSegments(
                          updateSegmentBounds(
                            document.segments,
                            selected.id,
                            selected.start_ms,
                            parsed,
                            project.duration_ms,
                          ),
                        );
                      else setNotice("结束时间格式应为 MM:SS.mmm");
                    }}
                  />
                </label>
              </div>
              <label className="annotation-inspector-field">
                <span>说话人</span>
                <div className="annotation-speaker-field">
                  <CustomSelect
                    ariaLabel="选择说话人"
                    value={selected.speaker_id ?? "unassigned"}
                    options={[
                      { value: "unassigned", label: "未指定" },
                      ...document.speakers.map((speaker) => ({
                        value: speaker.id,
                        label: speaker.name,
                      })),
                    ]}
                    onChange={(value) =>
                      updateSelected({
                        speaker_id: value === "unassigned" ? null : value,
                        status: "draft",
                      })
                    }
                    leadingIcon={
                      <i
                        className="annotation-speaker-dot"
                        style={{
                          background: selected.speaker_id
                            ? speakerById.get(selected.speaker_id)?.color
                            : "#8b9189",
                        }}
                      />
                    }
                  />
                  <button type="button" onClick={() => setSpeakerManager(true)}>
                    <Users aria-hidden /> 管理
                  </button>
                </div>
              </label>
              <LanguageAnnotationEditor
                key={selected.id}
                segment={selected}
                onFocus={() => {
                  if (!textBase.current) textBase.current = snapshot(document);
                }}
                onChange={(changes, record) =>
                  updateSelected(
                    {
                      ...changes,
                      status: "draft",
                    },
                    record,
                  )
                }
                onBlur={() => {
                  if (textBase.current)
                    setUndoStack((current) =>
                      [...current, textBase.current!].slice(-100),
                    );
                  textBase.current = null;
                }}
                transcription={segmentTranscription.controls}
              />
              <button
                type="button"
                role="checkbox"
                aria-checked={selected.status === "reviewed"}
                className={`annotation-reviewed${selected.status === "reviewed" ? " checked" : ""}`}
                onClick={() =>
                  updateSelected({
                    status:
                      selected.status === "reviewed" ? "draft" : "reviewed",
                  })
                }
              >
                <i>
                  {selected.status === "reviewed" ? (
                    <Check aria-hidden />
                  ) : null}
                </i>
                <span>标记为已校对</span>
              </button>
              <button
                type="button"
                className="btn primary annotation-apply"
                onClick={flushSave}
              >
                <Save aria-hidden /> 应用到片段
              </button>
              <footer>
                <kbd>空格</kbd> 播放/暂停 · <kbd>S</kbd> 切分 · <kbd>⌘Z</kbd>{" "}
                撤销 · 同一片段可维护多个语言版本
              </footer>
            </>
          ) : (
            <div className="annotation-inspector-empty">
              <Scissors aria-hidden />
              <strong>选择一个片段</strong>
              <span>也可以在波形上拖动创建新片段，片段可以重叠。</span>
            </div>
          )}
        </aside>
      </div>

      <SpeakerManager
        open={speakerManager}
        projectTitle={project.title}
        speakers={document.speakers}
        onClose={() => setSpeakerManager(false)}
        onChange={(speakers) =>
          applySnapshot({ ...snapshot(document), speakers })
        }
        onImport={(imported) => {
          const speakers = mergeImportedSpeakers(document.speakers, imported);
          applySnapshot({ ...snapshot(document), speakers });
          return speakers.length - document.speakers.length;
        }}
        onDelete={(speaker) => {
          setDeleteSpeakerReplacement("unassigned");
          setDeleteSpeaker(speaker);
        }}
      />
      {deleteSpeaker ? (
        <div className="annotation-modal-backdrop" role="presentation">
          <section
            className="annotation-modal annotation-delete-speaker-modal"
            role="dialog"
            aria-modal="true"
            aria-label="删除说话人"
          >
            <header>
              <div>
                <span className="eyebrow">删除说话人</span>
                <h2>重新分配“{deleteSpeaker.name}”的片段</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭"
                onClick={() => setDeleteSpeaker(null)}
              >
                <X aria-hidden />
              </button>
            </header>
            <p>
              选择替代说话人，或将相关片段设为未指定；这些片段会恢复为待校对。
            </p>
            <CustomSelect
              ariaLabel="删除后的替代说话人"
              value={deleteSpeakerReplacement}
              options={[
                { value: "unassigned", label: "设为未指定" },
                ...document.speakers
                  .filter((speaker) => speaker.id !== deleteSpeaker.id)
                  .map((speaker) => ({
                    value: speaker.id,
                    label: `替换为 ${speaker.name}`,
                  })),
              ]}
              onChange={setDeleteSpeakerReplacement}
            />
            <footer>
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteSpeaker(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  applySnapshot({
                    schema_version: "1.0",
                    speakers: document.speakers.filter(
                      (speaker) => speaker.id !== deleteSpeaker.id,
                    ),
                    segments: document.segments.map((segment) =>
                      segment.speaker_id === deleteSpeaker.id
                        ? {
                            ...segment,
                            speaker_id:
                              deleteSpeakerReplacement === "unassigned"
                                ? null
                                : deleteSpeakerReplacement,
                            status: "draft",
                          }
                        : segment,
                    ),
                  });
                  setDeleteSpeaker(null);
                }}
              >
                删除并重新分配
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      <SegmentTranscriptionDialogs controller={segmentTranscription} />
      <ConfirmDialog
        open={confirmMerge}
        title="合并不同说话人的片段？"
        description="合并后将保留当前片段的说话人，两个片段的文本会以换行连接。"
        confirmLabel="继续合并"
        onCancel={() => setConfirmMerge(false)}
        onConfirm={() => {
          if (selected)
            mutateSegments(mergeWithNext(document.segments, selected.id));
          setConfirmMerge(false);
        }}
      />
      <ConfirmDialog
        open={confirmLeave || Boolean(pendingNavigation)}
        title="离开并放弃未保存内容？"
        description="当前还有尚未保存到 Workspace 的修改。"
        confirmLabel="放弃并离开"
        onCancel={() => {
          setConfirmLeave(false);
          setPendingNavigation(null);
        }}
        onConfirm={() => {
          registerNavigationGuard(null);
          setDirty(false);
          setConfirmLeave(false);
          const continueNavigation = pendingNavigation;
          setPendingNavigation(null);
          if (continueNavigation) continueNavigation();
          else onBack();
        }}
      />
      <AudioAnnotationExportDialog
        open={exportOpen}
        project={project}
        document={document}
        onClose={() => setExportOpen(false)}
        onNotice={setNotice}
      />
    </section>
  );
}
