/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  FileAudio2,
  Folder,
  FolderOpen,
  LoaderCircle,
  Pause,
  Play,
  Search,
  X,
} from "lucide-react";
import {
  buildTranscriptionFile,
  safeFileBase,
} from "@features/audio-annotation";
import {
  getModelTestLibraryAudioFiles,
  getModelTestLibraryFolders,
  getModelTestTranscriptionAudio,
  type ModelTestLibraryAudio,
  type ModelTestTranscriptionTask,
} from "@features/models/api";
import { modelQueryKeys } from "@features/models/queryKeys";
import { formatFileSize } from "@shared/lib/fileSize";

const formatBytes = (bytes: number) =>
  formatFileSize(bytes, { minimumUnit: "KB", fractionalDigits: 0 });

export function formatDate(value: string) {
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

export function segmentTime(milliseconds: number) {
  return formatPosition(milliseconds / 1000);
}

export function downloadTranscriptionJson(task: ModelTestTranscriptionTask) {
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

export function ParameterSwitch({
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

export function TaskParameterSummary({
  task,
}: {
  task: ModelTestTranscriptionTask;
}) {
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

export function AudioPlayer({ task }: { task: ModelTestTranscriptionTask }) {
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

export function LibraryPicker({
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
    queryKey: modelQueryKeys.libraryFolders,
    queryFn: getModelTestLibraryFolders,
  });
  const filesQuery = useQuery({
    queryKey: modelQueryKeys.libraryAudio(folderId, search),
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
