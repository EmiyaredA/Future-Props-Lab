import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileJson,
  FileMusic,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { getFiles, uploadManagedFile } from "@features/files";
import {
  createAudioAnnotationProject,
  deleteAudioAnnotationProject,
  importAudioAnnotationProject,
  listAudioAnnotationProjects,
  renameAudioAnnotationProject,
} from "@features/audio-annotation/api";
import {
  formatDuration,
  MAX_AUDIO_BYTES,
  parseProjectFile,
} from "@features/audio-annotation/model";
import type {
  AnnotationProjectFile,
  AudioAnnotationProject,
} from "@features/audio-annotation/types";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import "@features/audio-annotation/audio-annotation.css";

const PROJECTS_KEY = ["audio-annotation-projects"] as const;

function bytes(value: number) {
  return value < 1024 * 1024
    ? `${(value / 1024).toFixed(1)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function ProjectDialog({
  open,
  imported,
  onClose,
  onCreated,
}: {
  open: boolean;
  imported: AnnotationProjectFile | null;
  onClose: () => void;
  onCreated: (project: AudioAnnotationProject) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(imported?.project.title ?? "");
  const [selectedId, setSelectedId] = useState(
    imported?.project.source.asset_id ?? "",
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const filesQuery = useQuery({
    queryKey: ["audio-annotation-library-audio", query],
    queryFn: () => getFiles({ query, mediaKind: "audio", sort: "updated" }),
    enabled: open,
  });
  const files = filesQuery.data?.items ?? [];
  const selected = files.find((file) => file.id === selectedId);

  useEffect(() => {
    if (!open) return;
    setTitle(imported?.project.title ?? "");
    setSelectedId(imported?.project.source.asset_id ?? "");
    setQuery("");
    setError("");
  }, [imported, open]);

  const create = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("请选择录音文件");
      const finalTitle = title.trim() || selected?.display_name || "录音标注";
      return imported
        ? importAudioAnnotationProject(finalTitle, selectedId, {
            schema_version: "1.0",
            speakers: imported.speakers,
            segments: imported.segments,
          })
        : createAudioAnnotationProject(finalTitle, selectedId);
    },
    onSuccess: onCreated,
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : "任务创建失败"),
  });

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES) {
      setError("录音不能超过 100 MiB");
      return;
    }
    if (
      !file.type.startsWith("audio/") &&
      !/\.(mp3|wav|m4a|ogg)$/i.test(file.name)
    ) {
      setError("请选择 MP3、WAV、M4A 或 OGG 录音");
      return;
    }
    try {
      const stored = await uploadManagedFile(file);
      setSelectedId(stored.id);
      if (!title.trim()) setTitle(stored.display_name);
      await filesQuery.refetch();
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "录音上传失败");
    }
  };

  if (!open) return null;
  return (
    <div className="annotation-modal-backdrop" role="presentation">
      <section
        className="annotation-modal"
        role="dialog"
        aria-modal="true"
        aria-label={imported ? "导入标注项目" : "新建标注任务"}
      >
        <header>
          <div>
            <span className="eyebrow">
              {imported ? "导入项目 JSON" : "Workspace 任务"}
            </span>
            <h2>{imported ? "选择对应录音" : "新建录音标注"}</h2>
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
        <label className="annotation-field">
          <span>任务名称</span>
          <input
            value={title}
            maxLength={120}
            placeholder="例如：产品访谈 08-18"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="annotation-source-actions">
          <input
            ref={fileInput}
            hidden
            type="file"
            accept=".mp3,.wav,.m4a,.ogg,audio/*"
            aria-label="上传录音文件"
            onChange={(event) => void upload(event)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden /> 上传新录音
          </button>
          <span>或从文件库选择</span>
        </div>
        <label className="annotation-library-search">
          <Search aria-hidden />
          <input
            value={query}
            placeholder="搜索音频文件…"
            aria-label="搜索音频文件"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div
          className="annotation-audio-list"
          role="listbox"
          aria-label="文件库音频"
        >
          {files.map((file) => (
            <button
              type="button"
              role="option"
              aria-selected={selectedId === file.id}
              className={selectedId === file.id ? "selected" : ""}
              key={file.id}
              disabled={file.byte_size > MAX_AUDIO_BYTES}
              onClick={() => {
                setSelectedId(file.id);
                if (!title.trim()) setTitle(file.display_name);
              }}
            >
              <FileMusic aria-hidden />
              <span>
                <strong>{file.display_name}</strong>
                <small>
                  {file.original_filename} · {bytes(file.byte_size)}
                </small>
              </span>
              {selectedId === file.id ? <CheckCircle2 aria-hidden /> : null}
            </button>
          ))}
          {!filesQuery.isLoading && !files.length ? (
            <p className="annotation-empty-row">文件库中没有匹配的录音。</p>
          ) : null}
        </div>
        {error ? (
          <p className="annotation-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!selectedId || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending
              ? "正在创建…"
              : imported
                ? "导入并打开"
                : "创建并打开"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function AudioAnnotationProjectsPage({
  onBack,
  onOpen,
}: {
  onBack: () => void;
  onOpen: (projectId: string) => void;
}) {
  const client = useQueryClient();
  const importInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [imported, setImported] = useState<AnnotationProjectFile | null>(null);
  const [renaming, setRenaming] = useState<AudioAnnotationProject | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<AudioAnnotationProject | null>(null);
  const [notice, setNotice] = useState("");
  const projectsQuery = useQuery({
    queryKey: [...PROJECTS_KEY, query],
    queryFn: () => listAudioAnnotationProjects(query),
  });
  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data?.items],
  );
  const summary = useMemo(
    () => ({
      projects: projects.length,
      segments: projects.reduce((sum, item) => sum + item.segment_count, 0),
    }),
    [projects],
  );

  const invalidate = () => client.invalidateQueries({ queryKey: PROJECTS_KEY });
  const rename = useMutation({
    mutationFn: () => renameAudioAnnotationProject(renaming!, renameValue),
    onSuccess: () => {
      setRenaming(null);
      void invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteAudioAnnotationProject(deleting!),
    onSuccess: () => {
      setDeleting(null);
      void invalidate();
    },
  });

  const readImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseProjectFile(JSON.parse(await file.text()));
      setImported(parsed);
      setDialogOpen(true);
      setNotice("");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "项目 JSON 无效");
    }
  };

  return (
    <section className="page annotation-projects-page">
      <header className="annotation-projects-header">
        <div>
          <button type="button" className="annotation-back" onClick={onBack}>
            <ArrowLeft aria-hidden /> 返回工具导航
          </button>
          <h1>录音分段标注</h1>
          <p>管理 Workspace 中的录音切分、说话人和逐段文本。</p>
        </div>
        <div className="annotation-project-actions">
          <input
            ref={importInput}
            hidden
            type="file"
            accept="application/json,.json"
            aria-label="导入项目 JSON"
            onChange={(event) => void readImport(event)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => importInput.current?.click()}
          >
            <FileJson aria-hidden /> 导入项目
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setImported(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden /> 新建任务
          </button>
        </div>
      </header>

      <div className="annotation-project-summary">
        <span>
          <strong>{summary.projects}</strong> 个任务
        </span>
        <span>
          <strong>{summary.segments}</strong> 个片段
        </span>
        <label>
          <Search aria-hidden />
          <input
            aria-label="搜索标注任务"
            placeholder="搜索任务名称…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {notice ? (
        <p className="annotation-error" role="alert">
          {notice}
        </p>
      ) : null}

      <div className="annotation-project-grid">
        {projects.map((project) => {
          const progress = project.segment_count
            ? Math.round(
                (project.reviewed_segment_count / project.segment_count) * 100,
              )
            : 0;
          return (
            <article className="annotation-project-card" key={project.id}>
              <button
                type="button"
                className="annotation-project-open"
                onClick={() => onOpen(project.id)}
                aria-label={`打开${project.title}`}
              >
                <span className="annotation-project-icon">
                  <FileMusic aria-hidden />
                </span>
                <span className="annotation-project-copy">
                  <strong>{project.title}</strong>
                  <small>{project.original_filename}</small>
                </span>
              </button>
              <div className="annotation-project-meta">
                <span>
                  <Clock3 aria-hidden /> {formatDuration(project.duration_ms)}
                </span>
                <span>{project.segment_count} 个片段</span>
                <span>{bytes(project.byte_size)}</span>
              </div>
              <div className="annotation-project-progress">
                <i style={{ width: `${progress}%` }} />
                <span>{progress}% 已校对</span>
              </div>
              <div className="annotation-project-card-actions">
                <button
                  type="button"
                  aria-label={`重命名${project.title}`}
                  onClick={() => {
                    setRenaming(project);
                    setRenameValue(project.title);
                  }}
                >
                  <Pencil aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`删除${project.title}`}
                  onClick={() => setDeleting(project)}
                >
                  <Trash2 aria-hidden />
                </button>
                <MoreHorizontal aria-hidden />
              </div>
            </article>
          );
        })}
        {!projectsQuery.isLoading && !projects.length ? (
          <div className="annotation-projects-empty">
            <FileMusic aria-hidden />
            <strong>还没有录音标注任务</strong>
            <span>上传录音或从文件库选择一段音频开始。</span>
            <button
              className="btn primary"
              type="button"
              onClick={() => setDialogOpen(true)}
            >
              新建第一个任务
            </button>
          </div>
        ) : null}
      </div>

      <ProjectDialog
        open={dialogOpen}
        imported={imported}
        onClose={() => setDialogOpen(false)}
        onCreated={(project) => {
          setDialogOpen(false);
          void invalidate();
          onOpen(project.id);
        }}
      />
      {renaming ? (
        <div className="annotation-modal-backdrop" role="presentation">
          <section
            className="annotation-modal annotation-rename-modal"
            role="dialog"
            aria-modal="true"
            aria-label="重命名标注任务"
          >
            <header>
              <h2>重命名任务</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭"
                onClick={() => setRenaming(null)}
              >
                <X aria-hidden />
              </button>
            </header>
            <label className="annotation-field">
              <span>任务名称</span>
              <input
                autoFocus
                value={renameValue}
                maxLength={120}
                onChange={(event) => setRenameValue(event.target.value)}
              />
            </label>
            {rename.isError ? (
              <p className="annotation-error" role="alert">
                重命名失败，请重试。
              </p>
            ) : null}
            <footer>
              <button
                type="button"
                className="btn"
                onClick={() => setRenaming(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!renameValue.trim() || rename.isPending}
                onClick={() => rename.mutate()}
              >
                保存
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除标注任务？"
        description="标注、说话人和波形数据将被删除，原始录音会继续保留在文件库中。"
        confirmLabel="删除任务"
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          await remove.mutateAsync();
        }}
      />
    </section>
  );
}
