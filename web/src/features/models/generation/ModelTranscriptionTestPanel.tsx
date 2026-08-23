import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Download,
  FileAudio2,
  FileInput,
  Folder,
  FolderOpen,
  LoaderCircle,
  Mic2,
  Pause,
  Play,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  buildTranscriptionFile,
  importAudioAnnotationTranscriptionTask,
  MIN_SEGMENT_MS,
  safeFileBase,
} from "@features/audio-annotation";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";
import {
  createModelTestTranscriptionFromLibrary,
  deleteModelTestTranscriptionTask,
  getModelTestLibraryAudioFiles,
  getModelTestLibraryFolders,
  getModelTestTranscriptionAudio,
  getModelTestTranscriptionOptions,
  getModelTestTranscriptionTasks,
  uploadModelTestTranscription,
  type ModelTestLibraryAudio,
  type ModelTestTranscriptionParameters,
  type ModelTestTranscriptionTask,
} from "@features/models/api";
import {
  ModelTestWorkspaceHeader,
  type ModelTestMode,
} from "@features/models/workspace/ModelTestWorkspaceHeader";

type TestModel = {
  value: string;
  label: string;
  description: string;
  capabilities: string[];
  providerKind: string;
};

const pendingStatuses: ModelTestTranscriptionTask["status"][] = [
  "queued",
  "running",
];
const statusLabels: Record<ModelTestTranscriptionTask["status"], string> = {
  queued: "等待识别",
  running: "识别中",
  completed: "已完成",
  failed: "失败",
};
const fallbackParameters: ModelTestTranscriptionParameters = {
  language: "auto",
  target_language: null,
  enable_word_timestamps: false,
  enable_text_edit: false,
  enable_speaker_diarization: false,
  max_speakers: null,
  enable_punctuation: false,
  hotwords: null,
  abbreviations: false,
};

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPosition(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function segmentTime(milliseconds: number) {
  return formatPosition(milliseconds / 1000);
}

function downloadTranscriptionJson(task: ModelTestTranscriptionTask) {
  const output = buildTranscriptionFile(task);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(output, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  const basename = task.source.filename.replace(/\.[^.]+$/, "");
  anchor.href = url;
  anchor.download = `${safeFileBase(basename)}.transcription.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ParameterSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="transcription-parameter-switch"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <i className={checked ? "active" : ""} aria-hidden>
        <b />
      </i>
    </button>
  );
}

function TaskParameterSummary({ task }: { task: ModelTestTranscriptionTask }) {
  const values = [
    `语言：${task.parameters.language}`,
    task.parameters.target_language
      ? `翻译：${task.parameters.target_language}`
      : null,
    task.parameters.enable_punctuation ? "标点" : null,
    task.parameters.enable_text_edit ? "文本整理" : null,
    task.parameters.enable_speaker_diarization
      ? `说话人识别${task.parameters.max_speakers ? `（最多 ${task.parameters.max_speakers} 人）` : ""}`
      : null,
    task.parameters.enable_word_timestamps ? "字词时间戳" : null,
    task.parameters.hotwords ? `热词：${task.parameters.hotwords}` : null,
    task.parameters.abbreviations ? "缩写替换" : null,
  ].filter((value): value is string => Boolean(value));
  return (
    <section className="transcription-parameter-summary">
      <header>
        <div>
          <strong>任务参数</strong>
          <span>提交时快照</span>
        </div>
      </header>
      <div>
        {values.map((value) => (
          <span key={value}>{value}</span>
        ))}
      </div>
    </section>
  );
}

function AudioPlayer({ task }: { task: ModelTestTranscriptionTask }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const rangeMax = duration > 0 ? duration : 1;
  const rangeValue = duration > 0 ? Math.min(position, duration) : 0;
  const progressPercent = duration > 0 ? (rangeValue / duration) * 100 : 0;

  useEffect(() => {
    let objectUrl = "";
    let disposed = false;
    setUrl("");
    setError("");
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    if (!task.source.available) return;
    void getModelTestTranscriptionAudio(task.id)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((cause) => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [task.id, task.source.available]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  return (
    <div className="transcription-player">
      <audio
        ref={audioRef}
        className="transcription-native-audio"
        src={url || undefined}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        aria-label={playing ? "暂停音频" : "播放音频"}
        disabled={!url}
        onClick={() => void toggle()}
      >
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </button>
      <div>
        <strong>{task.source.filename}</strong>
        <span>{formatBytes(task.source.byte_size)}</span>
      </div>
      <div className="transcription-progress-control">
        <span className="transcription-progress-track" aria-hidden>
          <i style={{ width: `${progressPercent}%` }} />
        </span>
        <input
          type="range"
          aria-label="音频播放进度"
          min="0"
          max={rangeMax}
          step="0.1"
          value={rangeValue}
          disabled={!url || !duration}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (audioRef.current) audioRef.current.currentTime = next;
            setPosition(next);
          }}
        />
      </div>
      <time>
        {formatPosition(position)} / {formatPosition(duration)}
      </time>
      {error ? (
        <small className="transcription-player-error">{error}</small>
      ) : null}
    </div>
  );
}

function LibraryPicker({
  maxBytes,
  onClose,
  onSelect,
}: {
  maxBytes: number;
  onClose: () => void;
  onSelect: (file: ModelTestLibraryAudio) => void;
}) {
  const maxLabel = `${Math.round(maxBytes / 1024 / 1024)} MB`;
  const [folderId, setFolderId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const foldersQuery = useQuery({
    queryKey: ["model-test-library-folders"],
    queryFn: getModelTestLibraryFolders,
  });
  const filesQuery = useQuery({
    queryKey: ["model-test-library-audio", folderId, search],
    queryFn: () =>
      getModelTestLibraryAudioFiles({
        folderId,
        query: search.trim() || undefined,
      }),
  });
  const folders = foldersQuery.data?.items ?? [];
  const currentFolder = folders.find((folder) => folder.id === folderId);
  const childFolders = folders.filter(
    (folder) => (folder.parent_id ?? undefined) === folderId,
  );
  const goBack = () => setFolderId(currentFolder?.parent_id ?? undefined);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card transcription-library-modal"
        role="dialog"
        aria-modal="true"
        aria-label="从文件管理选择音频"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">文件管理</span>
            <h2>选择音频</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </div>
        <div className="transcription-library-tools">
          <button type="button" disabled={!folderId} onClick={goBack}>
            <ChevronLeft aria-hidden /> 返回
          </button>
          <span>
            <FolderOpen aria-hidden /> {currentFolder?.name ?? "文件管理根目录"}
          </span>
          <label>
            <Search aria-hidden />
            <input
              type="search"
              value={search}
              aria-label="搜索文件管理音频"
              placeholder="搜索音频"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="transcription-library-list">
          {!search.trim() &&
            childFolders.map((folder) => (
              <button
                type="button"
                className="folder"
                key={folder.id}
                onClick={() => setFolderId(folder.id)}
              >
                <Folder aria-hidden />
                <span>
                  <strong>{folder.name}</strong>
                  <small>文件夹</small>
                </span>
              </button>
            ))}
          {(filesQuery.data?.items ?? []).map((file) => {
            const tooLarge = file.byte_size > maxBytes;
            return (
              <button
                type="button"
                key={file.id}
                disabled={tooLarge}
                title={tooLarge ? `超过 ${maxLabel}，不能用于识别` : undefined}
                onClick={() => onSelect(file)}
              >
                <FileAudio2 aria-hidden />
                <span>
                  <strong>{file.display_name}</strong>
                  <small>
                    {file.original_filename} · {formatBytes(file.byte_size)}
                    {tooLarge ? ` · 超过 ${maxLabel}` : ""}
                  </small>
                </span>
              </button>
            );
          })}
          {filesQuery.isLoading || foldersQuery.isLoading ? (
            <div className="transcription-library-empty">
              <LoaderCircle className="spinning" aria-hidden /> 正在加载
            </div>
          ) : !childFolders.length && !filesQuery.data?.items.length ? (
            <div className="transcription-library-empty">这里没有音频文件</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ModelTranscriptionTestPanel({
  models,
  modelId,
  onSelectModel,
  onSelectMode,
  onOpenAudioAnnotation,
}: {
  models: TestModel[];
  modelId: string;
  onSelectModel: (modelId: string) => void;
  onSelectMode: (mode: ModelTestMode) => void;
  onOpenAudioAnnotation: (projectId: string) => void;
}) {
  const client = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [parameters, setParameters] =
    useState<ModelTestTranscriptionParameters>(fallbackParameters);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [libraryFile, setLibraryFile] = useState<ModelTestLibraryAudio | null>(
    null,
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState("");
  const localInputRef = useRef<HTMLInputElement>(null);
  const speechModels = useMemo(
    () =>
      models.filter(
        (model) =>
          ["openai", "senseaudio_asr"].includes(model.providerKind) &&
          model.capabilities.includes("speech_recognition"),
      ),
    [models],
  );
  const availableModes: Record<ModelTestMode, boolean> = {
    chat: models.some(
      (model) =>
        ["openai", "anthropic"].includes(model.providerKind) &&
        model.capabilities.includes("chat"),
    ),
    image: models.some((model) => model.providerKind === "senseaudio_image"),
    video: models.some((model) => model.providerKind === "senseaudio_video"),
    speech: Boolean(speechModels.length),
    realtime_voice: models.some((model) =>
      model.capabilities.includes("voice"),
    ),
  };
  const modelOptions: SelectOption[] = speechModels.map((model) => ({
    value: model.value,
    label: model.label,
    description: model.description,
  }));
  const optionsQuery = useQuery({
    queryKey: ["model-test-transcription-options"],
    queryFn: getModelTestTranscriptionOptions,
  });
  const selectedTranscriptionOption = optionsQuery.data?.items.find(
    (option) => option.id === modelId,
  );
  const capabilities = selectedTranscriptionOption?.parameter_capabilities;
  const languageOptions: SelectOption[] =
    capabilities?.language_options.map((option) => ({
      value: option.value,
      label: option.label,
    })) ?? [];
  const targetLanguageOptions: SelectOption[] = [
    { value: "", label: "不翻译" },
    ...(capabilities?.target_language_options.map((option) => ({
      value: option.value,
      label: option.label,
    })) ?? []),
  ];
  const maxBytes =
    selectedTranscriptionOption?.max_input_bytes ??
    optionsQuery.data?.max_input_bytes ??
    10 * 1024 * 1024;
  const maxLabel = `${Math.round(maxBytes / 1024 / 1024)} MB`;
  const tasksQuery = useQuery({
    queryKey: ["model-test-transcription-tasks", modelId],
    queryFn: () => getModelTestTranscriptionTasks(modelId),
    refetchInterval: (query) =>
      query.state.data?.items.some((task) =>
        pendingStatuses.includes(task.status),
      )
        ? 2000
        : false,
  });
  const tasks = tasksQuery.data?.items ?? [];
  const normalizedSearch = taskSearch.trim().toLowerCase();
  const filteredTasks = normalizedSearch
    ? tasks.filter((task) =>
        `${task.source.filename} ${task.model_slug} ${task.result_text ?? ""}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : tasks;
  const activeTask = tasks.find((task) => task.id === activeId) ?? tasks[0];

  useEffect(() => {
    setActiveId(null);
    setTaskSearch("");
    setError("");
    setLocalFile(null);
    setLibraryFile(null);
    if (localInputRef.current) localInputRef.current.value = "";
  }, [modelId]);

  useEffect(() => {
    if (selectedTranscriptionOption)
      setParameters(
        selectedTranscriptionOption.parameter_capabilities.defaults,
      );
  }, [selectedTranscriptionOption]);

  const setParameter = <Key extends keyof ModelTestTranscriptionParameters>(
    key: Key,
    value: ModelTestTranscriptionParameters[Key],
  ) => setParameters((current) => ({ ...current, [key]: value }));

  const refresh = async () => {
    await Promise.all([
      tasksQuery.refetch(),
      client.invalidateQueries({ queryKey: ["model-logs"] }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: () => {
      if (localFile)
        return uploadModelTestTranscription(localFile, modelId, parameters);
      if (libraryFile)
        return createModelTestTranscriptionFromLibrary(
          libraryFile.id,
          modelId,
          parameters,
        );
      throw new Error("请先选择一个音频文件");
    },
    onSuccess: async (task) => {
      setActiveId(task.id);
      setLocalFile(null);
      setLibraryFile(null);
      setError("");
      if (localInputRef.current) localInputRef.current.value = "";
      await refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const deleteMutation = useMutation({
    mutationFn: (task: ModelTestTranscriptionTask) =>
      deleteModelTestTranscriptionTask(task),
    onSuccess: async () => {
      setActiveId(null);
      await refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const importMutation = useMutation({
    mutationFn: (task: ModelTestTranscriptionTask) =>
      importAudioAnnotationTranscriptionTask(task.id),
    onSuccess: (project) => onOpenAudioAnnotation(project.id),
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const shortImportSegmentCount =
    activeTask?.result_segments.filter(
      (segment) => segment.end_ms - segment.start_ms < MIN_SEGMENT_MS,
    ).length ?? 0;
  const chooseLocal = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > maxBytes) {
      setError(`音频「${file.name}」超过 ${maxLabel}，不能提交。`);
      if (localInputRef.current) localInputRef.current.value = "";
      return;
    }
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
    if (![".mp3", ".wav", ".m4a", ".ogg"].includes(extension)) {
      setError("仅支持 MP3、WAV、M4A 和 OGG 音频。");
      if (localInputRef.current) localInputRef.current.value = "";
      return;
    }
    setError("");
    setLocalFile(file);
    setLibraryFile(null);
  };

  return (
    <section className="model-test-page transcription-test-page">
      <ModelTestWorkspaceHeader
        activeMode="speech"
        availableModes={availableModes}
        onSelectMode={onSelectMode}
        modelId={modelId}
        modelOptions={modelOptions}
        onSelectModel={onSelectModel}
      />
      {error ? (
        <div className="inline-alert danger playground-alert" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="transcription-test-grid">
        <aside className="transcription-history">
          <div className="transcription-section-head">
            <div>
              <strong>识别记录</strong>
              <span>{tasks.length} 条</span>
            </div>
            <label>
              <Search aria-hidden />
              <input
                type="search"
                aria-label="搜索识别任务"
                placeholder="搜索文件或转写"
                value={taskSearch}
                onChange={(event) => setTaskSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="transcription-task-list">
            {filteredTasks.map((task) => (
              <button
                type="button"
                className={task.id === activeTask?.id ? "active" : ""}
                key={task.id}
                onClick={() => setActiveId(task.id)}
              >
                <span className="transcription-task-icon">
                  <FileAudio2 aria-hidden />
                </span>
                <span>
                  <strong>{task.source.filename}</strong>
                  <small>
                    {formatDate(task.created_at)} ·{" "}
                    {formatBytes(task.source.byte_size)}
                  </small>
                  <em className={task.status}>
                    {task.status === "completed" ? (
                      <CheckCircle2 aria-hidden />
                    ) : null}
                    {statusLabels[task.status]}
                  </em>
                </span>
              </button>
            ))}
            {!filteredTasks.length ? (
              <div className="transcription-empty compact">
                <Mic2 aria-hidden />
                <strong>还没有识别记录</strong>
                <span>选择音频并开始测试后会显示在这里。</span>
              </div>
            ) : null}
          </div>
        </aside>
        <main className="transcription-result">
          {activeTask ? (
            <>
              <div className="transcription-result-head">
                <div>
                  <strong>{activeTask.model_slug}</strong>
                  <span className={activeTask.status}>
                    {statusLabels[activeTask.status]}
                  </span>
                </div>
                <div className="transcription-result-actions">
                  {activeTask.status === "completed" ? (
                    <>
                      <small className="transcription-import-note" role="note">
                        导入时会忽略
                        {shortImportSegmentCount
                          ? ` ${shortImportSegmentCount} 个`
                          : ""}
                        短于 {MIN_SEGMENT_MS} 毫秒的识别片段
                      </small>
                      <button
                        type="button"
                        onClick={() => downloadTranscriptionJson(activeTask)}
                      >
                        <Download aria-hidden /> 导出 JSON
                      </button>
                      <button
                        type="button"
                        disabled={importMutation.isPending}
                        onClick={() => importMutation.mutate(activeTask)}
                      >
                        {importMutation.isPending ? (
                          <LoaderCircle className="spinning" aria-hidden />
                        ) : (
                          <FileInput aria-hidden />
                        )}
                        {importMutation.isPending ? "正在导入" : "导入标注"}
                      </button>
                    </>
                  ) : null}
                  {!pendingStatuses.includes(activeTask.status) ? (
                    <button
                      type="button"
                      className="icon-only"
                      aria-label="删除识别任务"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(activeTask)}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
              <AudioPlayer task={activeTask} />
              {pendingStatuses.includes(activeTask.status) ? (
                <div className="transcription-empty">
                  <LoaderCircle className="spinning" aria-hidden />
                  <strong>{statusLabels[activeTask.status]}</strong>
                  <span>任务会在后台继续执行，刷新页面也不会丢失。</span>
                </div>
              ) : activeTask.status === "failed" ? (
                <div className="transcription-empty failed">
                  <strong>识别失败</strong>
                  <span>{activeTask.error_message}</span>
                </div>
              ) : (
                <div className="transcription-copy">
                  <TaskParameterSummary task={activeTask} />
                  {activeTask.result_detail.warnings?.length ? (
                    <section className="transcription-warnings">
                      <header>
                        <div>
                          <strong>
                            <AlertTriangle aria-hidden /> 处理提示
                          </strong>
                          <span>
                            {activeTask.result_detail.processing_status}
                          </span>
                        </div>
                      </header>
                      <ul>
                        {activeTask.result_detail.warnings.map(
                          (warning, index) => (
                            <li key={`${warning.code}-${index}`}>
                              <strong>{warning.stage ?? warning.code}</strong>
                              {warning.message}
                            </li>
                          ),
                        )}
                      </ul>
                    </section>
                  ) : null}
                  <section>
                    <header>
                      <div>
                        <strong>完整转写</strong>
                        <span>{activeTask.result_text?.length ?? 0} 字</span>
                      </div>
                      <button
                        type="button"
                        aria-label="复制完整转写"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            activeTask.result_text ?? "",
                          )
                        }
                      >
                        <Copy aria-hidden /> 复制
                      </button>
                    </header>
                    <p>{activeTask.result_text || "模型未返回转写文本"}</p>
                  </section>
                  {activeTask.result_segments.length ? (
                    <section>
                      <header>
                        <div>
                          <strong>说话人分段</strong>
                          <span>{activeTask.result_segments.length} 段</span>
                        </div>
                      </header>
                      <div className="transcription-segments">
                        {activeTask.result_segments.map((segment, index) => (
                          <article key={`${segment.start_ms}-${index}`}>
                            <span
                              className={`speaker-color speaker-${index % 6}`}
                              aria-hidden
                            />
                            <div>
                              <strong>
                                {segment.speaker === "unknown"
                                  ? "未知说话人"
                                  : segment.speaker}
                              </strong>
                              {segment.is_overlap ? (
                                <span className="transcription-overlap-badge">
                                  重叠
                                </span>
                              ) : null}
                              <time>
                                {segmentTime(segment.start_ms)} –{" "}
                                {segmentTime(segment.end_ms)}
                              </time>
                              <p>{segment.text}</p>
                              {segment.speaker_candidates?.length ? (
                                <small className="transcription-candidates">
                                  候选说话人：
                                  {segment.speaker_candidates.join("、")}
                                </small>
                              ) : null}
                              {segment.translation ? (
                                <p className="transcription-translation">
                                  译文：{segment.translation}
                                </p>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : (
                    <p className="transcription-no-segments">
                      当前供应商未返回说话人分段或句级时间戳。
                    </p>
                  )}
                  {activeTask.result_detail.words?.length ? (
                    <details className="transcription-word-details">
                      <summary>
                        字词时间戳（{activeTask.result_detail.words.length} 项）
                      </summary>
                      <div>
                        {activeTask.result_detail.words.map((word, index) => (
                          <span key={`${word.start_ms}-${index}`}>
                            <strong>{word.word}</strong>
                            <time>
                              {segmentTime(word.start_ms)}–
                              {segmentTime(word.end_ms)}
                            </time>
                          </span>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <div className="transcription-empty">
              <span className="transcription-empty-icon">
                <Mic2 aria-hidden />
              </span>
              <strong>开始一次语音识别测试</strong>
              <span>上传本地音频或从文件管理选择，转写结果会显示在这里。</span>
            </div>
          )}
        </main>
        <aside className="transcription-settings">
          <div className="transcription-settings-head">
            <strong>识别参数</strong>
            <span>单文件最大 {maxLabel}</span>
          </div>
          <div className="transcription-source-options">
            <button
              type="button"
              onClick={() => localInputRef.current?.click()}
            >
              <Upload aria-hidden />
              <span>
                <strong>上传本地音频</strong>
                <small>MP3、WAV、M4A、OGG</small>
              </span>
            </button>
            <input
              ref={localInputRef}
              hidden
              type="file"
              aria-label="上传本地音频"
              accept=".mp3,.wav,.m4a,.ogg,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg"
              onChange={(event) => chooseLocal(event.target.files)}
            />
            <button type="button" onClick={() => setLibraryOpen(true)}>
              <FolderOpen aria-hidden />
              <span>
                <strong>从文件管理选择</strong>
                <small>支持文件夹与搜索</small>
              </span>
            </button>
          </div>
          {localFile || libraryFile ? (
            <div className="transcription-selected-file">
              <FileAudio2 aria-hidden />
              <div>
                <strong>{localFile?.name ?? libraryFile?.display_name}</strong>
                <span>
                  {formatBytes(localFile?.size ?? libraryFile?.byte_size ?? 0)}{" "}
                  · {localFile ? "本地上传" : "文件管理"}
                </span>
              </div>
              <button
                type="button"
                aria-label="移除已选音频"
                onClick={() => {
                  setLocalFile(null);
                  setLibraryFile(null);
                  if (localInputRef.current) localInputRef.current.value = "";
                }}
              >
                <X aria-hidden />
              </button>
            </div>
          ) : null}
          {capabilities ? (
            <div className="transcription-parameter-fields">
              <label className="transcription-language-field">
                <span>识别语言</span>
                {capabilities.language_mode === "candidates" ? (
                  <>
                    <input
                      type="text"
                      aria-label="识别语言"
                      value={parameters.language}
                      placeholder="auto 或 Chinese,English"
                      onChange={(event) =>
                        setParameter("language", event.target.value)
                      }
                    />
                    <small>支持 auto 或逗号分隔的语言候选名称。</small>
                  </>
                ) : (
                  <CustomSelect
                    ariaLabel="识别语言"
                    value={parameters.language}
                    options={languageOptions}
                    onChange={(value) => setParameter("language", value)}
                  />
                )}
              </label>
              {capabilities.target_language_options.length ? (
                <label className="transcription-language-field">
                  <span>翻译语言</span>
                  <CustomSelect
                    ariaLabel="翻译语言"
                    value={parameters.target_language ?? ""}
                    options={targetLanguageOptions}
                    onChange={(value) =>
                      setParameter("target_language", value || null)
                    }
                  />
                </label>
              ) : null}
              {capabilities.supports_punctuation ? (
                <ParameterSwitch
                  label="自动标点"
                  description="补充适合阅读的标点符号"
                  checked={parameters.enable_punctuation}
                  onChange={(value) =>
                    setParameter("enable_punctuation", value)
                  }
                />
              ) : null}
              {capabilities.supports_text_edit ? (
                <ParameterSwitch
                  label="文本整理"
                  description="整理口语文本和格式"
                  checked={parameters.enable_text_edit}
                  onChange={(value) => setParameter("enable_text_edit", value)}
                />
              ) : null}
              {capabilities.supports_speaker_diarization ? (
                <ParameterSwitch
                  label="说话人识别"
                  description="区分音频中的不同说话人"
                  checked={parameters.enable_speaker_diarization}
                  onChange={(value) => {
                    setParameter("enable_speaker_diarization", value);
                    if (!value) setParameter("max_speakers", null);
                  }}
                />
              ) : null}
              {capabilities.supports_max_speakers &&
              parameters.enable_speaker_diarization ? (
                <label className="transcription-language-field">
                  <span>最大说话人数</span>
                  <CustomSelect
                    ariaLabel="最大说话人数"
                    value={parameters.max_speakers?.toString() ?? ""}
                    options={[
                      { value: "", label: "自动判断" },
                      ...Array.from({ length: 20 }, (_, index) => ({
                        value: String(index + 1),
                        label: `${index + 1} 人`,
                      })),
                    ]}
                    onChange={(value) =>
                      setParameter("max_speakers", value ? Number(value) : null)
                    }
                  />
                </label>
              ) : null}
              {capabilities.supports_word_timestamps ? (
                <ParameterSwitch
                  label="字词时间戳"
                  description="返回更细粒度的字词时间位置"
                  checked={parameters.enable_word_timestamps}
                  onChange={(value) =>
                    setParameter("enable_word_timestamps", value)
                  }
                />
              ) : null}
              {capabilities.supports_hotwords ? (
                <label className="transcription-language-field">
                  <span>热词</span>
                  <input
                    type="text"
                    aria-label="热词"
                    value={parameters.hotwords ?? ""}
                    placeholder="输入人名、术语或专有词"
                    onChange={(event) =>
                      setParameter("hotwords", event.target.value || null)
                    }
                  />
                </label>
              ) : null}
              {capabilities.supports_abbreviations ? (
                <ParameterSwitch
                  label="缩写替换"
                  description="启用模型的缩写规范化能力"
                  checked={parameters.abbreviations}
                  onChange={(value) => setParameter("abbreviations", value)}
                />
              ) : null}
            </div>
          ) : null}
          <div className="transcription-limit-note">
            <strong>不会自动切片</strong>
            <p>
              超过 {maxLabel}{" "}
              的音频会显示为超限并禁止提交，请先在外部压缩或裁剪。
            </p>
          </div>
          <button
            type="button"
            className="transcription-submit"
            disabled={createMutation.isPending || (!localFile && !libraryFile)}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <LoaderCircle className="spinning" aria-hidden />
            ) : (
              <Mic2 aria-hidden />
            )}
            {createMutation.isPending ? "正在创建任务" : "开始识别"}
          </button>
        </aside>
      </div>
      {libraryOpen ? (
        <LibraryPicker
          maxBytes={maxBytes}
          onClose={() => setLibraryOpen(false)}
          onSelect={(file) => {
            setLibraryFile(file);
            setLocalFile(null);
            setLibraryOpen(false);
            setError("");
          }}
        />
      ) : null}
    </section>
  );
}
