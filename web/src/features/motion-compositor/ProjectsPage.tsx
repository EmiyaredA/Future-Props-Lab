import type { ReactNode } from "react";
import { LoadingState } from "@shared/ui/LoadingState";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  Download,
  Film,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  WorkshopAppChrome,
  WorkshopSearch,
} from "@shared/ui/WorkshopAppChrome";
import { downloadProjectSnapshot } from "@shared/ui/project-library";
import {
  createProject,
  deleteProject,
  downloadSnapshot,
  importSnapshot,
  listProjects,
  patchProject,
} from "./api";
import type { MotionProject } from "./types";
import "./projects.css";

type FormState = {
  title: string;
  aspect: "16:9" | "9:16" | "1:1";
  fps: 30 | 60;
  starter: "blank" | "comic-entry";
};
const INITIAL: FormState = {
  title: "怪盗风格片头",
  aspect: "16:9",
  fps: 30,
  starter: "comic-entry",
};

export function ProjectsPage({
  utilities,
  onOpen,
  readOnly = false,
}: {
  utilities?: ReactNode;
  onOpen: (id: string) => void;
  readOnly?: boolean;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [projects, setProjects] = useState<MotionProject[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(INITIAL);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MotionProject | null>(null);
  const [deleting, setDeleting] = useState<MotionProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const result = await listProjects();
    setProjects(result.items);
  };
  useEffect(() => {
    let alive = true;
    void listProjects()
      .then((result) => {
        if (alive) setProjects(result.items);
      })
      .catch((caught: unknown) => {
        if (alive)
          setError(caught instanceof Error ? caught.message : "项目读取失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (editing) {
        await patchProject(editing.id, editing.revision, form.title);
        setEditing(null);
        setOpen(false);
        await refresh();
      } else {
        const created = await createProject(form);
        setOpen(false);
        await refresh();
        onOpen(created.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await deleteProject(deleting.id, deleting.revision);
      setDeleting(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };
  const filtered = projects.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <section className="workshop-page mc-projects">
      <TransferFeedback progress={activeTransferProgress} />

      <WorkshopAppChrome
        utilities={utilities}
        showThemeToggle={false}
        title="我的特效项目"
        actions={
          <>
            <WorkshopSearch
              label="搜索特效项目"
              placeholder="搜索特效项目…"
              value={query}
              onChange={setQuery}
            />
            {!readOnly && (
              <>
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept=".zip"
                  aria-label="导入特效工程包"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    void runTransfer((onProgress) =>
                      importSnapshot(file, { onProgress }),
                    )
                      .then(async (project) => {
                        await refresh();
                        onOpen(project.id);
                      })
                      .catch((caught: unknown) =>
                        setError(
                          caught instanceof Error ? caught.message : "导入失败",
                        ),
                      )
                      .finally(() => {
                        setBusy(false);
                        event.target.value = "";
                      });
                  }}
                />
                <button
                  className="mc-secondary"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                >
                  <Upload size={16} /> 导入项目
                </button>
                <button
                  className="workshop-primary"
                  onClick={() => {
                    setForm(INITIAL);
                    setEditing(null);
                    setOpen(true);
                  }}
                >
                  <Plus size={18} /> 新建项目
                </button>
              </>
            )}
          </>
        }
      />
      {error && (
        <div className="mc-error" role="alert">
          {error}
          <button aria-label="关闭错误提示" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {loading ? (
        <LoadingState
          label="正在读取项目…"
          variant="region"
          className="mc-empty"
        />
      ) : (
        <div className="mc-project-grid">
          {filtered.map((project, index) => (
            <article className="mc-project-card" key={project.id}>
              <button
                className="mc-project-cover"
                onClick={() => onOpen(project.id)}
                aria-label={`打开${project.title}`}
              >
                <span className="mc-cover-slice" />
                <span className="mc-cover-spark">✦</span>
                <strong>{project.title}</strong>
                <small>FX / {String(index + 1).padStart(2, "0")}</small>
              </button>
              <div className="mc-project-card-body">
                <h3>{project.title}</h3>
                <p>
                  {new Date(project.updatedAt).toLocaleString("zh-CN")} 更新
                </p>
                <div className="mc-card-actions">
                  <button
                    className="mc-open"
                    onClick={() => onOpen(project.id)}
                  >
                    进入制作 <ArrowRight size={16} />
                  </button>
                  {!readOnly && (
                    <>
                      <button
                        aria-label={`重命名${project.title}`}
                        onClick={() => {
                          setEditing(project);
                          setForm({ ...INITIAL, title: project.title });
                          setOpen(true);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        aria-label={`下载${project.title}工程包`}
                        onClick={() =>
                          void runTransfer((onProgress) =>
                            downloadSnapshot(project.id, { onProgress }),
                          )
                            .then((file) =>
                              downloadProjectSnapshot(
                                file,
                                `${project.title}.zip`,
                              ),
                            )
                            .catch((caught: unknown) =>
                              setError(
                                caught instanceof Error
                                  ? caught.message
                                  : "下载失败",
                              ),
                            )
                        }
                      >
                        <Download size={16} />
                      </button>
                      <button
                        aria-label={`删除${project.title}`}
                        onClick={() => setDeleting(project)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
          {!readOnly && (
            <button
              className="mc-new-card"
              onClick={() => {
                setForm(INITIAL);
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus size={30} />
              <strong>开始新的特效项目</strong>
              <span>空白画布或选用特效模板</span>
            </button>
          )}
          {!filtered.length && readOnly && (
            <p className="mc-empty">还没有可查看的特效项目。</p>
          )}
        </div>
      )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="mc-dialog-overlay" />
          <Dialog.Content className="mc-dialog">
            <Dialog.Title>
              {editing ? "重命名特效项目" : "新建特效项目"}
            </Dialog.Title>
            <Dialog.Description>
              建立可编辑的镜头特效，随后可以加入视频、图形和 AI 素材。
            </Dialog.Description>
            <label className="mc-field">
              项目名称
              <input
                value={form.title}
                maxLength={120}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </label>
            {!editing && (
              <>
                <div className="mc-form-row">
                  <div>
                    <strong>画幅</strong>
                    <div className="mc-options">
                      {(["16:9", "9:16", "1:1"] as const).map((aspect) => (
                        <button
                          key={aspect}
                          aria-pressed={form.aspect === aspect}
                          onClick={() => setForm({ ...form, aspect })}
                        >
                          {aspect}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <strong>帧率</strong>
                    <div className="mc-options">
                      {([30, 60] as const).map((fps) => (
                        <button
                          key={fps}
                          aria-pressed={form.fps === fps}
                          onClick={() => setForm({ ...form, fps })}
                        >
                          {fps} fps
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <strong className="mc-mode-label">开始方式</strong>
                <div className="mc-mode-options">
                  <button
                    aria-pressed={form.starter === "blank"}
                    onClick={() => setForm({ ...form, starter: "blank" })}
                  >
                    <Film size={20} />
                    <strong>空白项目</strong>
                    <span>从视频、图片和图形图层开始</span>
                  </button>
                  <button
                    aria-pressed={form.starter === "comic-entry"}
                    onClick={() => setForm({ ...form, starter: "comic-entry" })}
                  >
                    <Sparkles size={20} />
                    <strong>特效模板</strong>
                    <span>从「漫画风人物切入」开始</span>
                  </button>
                </div>
              </>
            )}
            {error && (
              <p className="mc-error" role="alert">
                {error}
              </p>
            )}
            <div className="mc-dialog-actions">
              <Dialog.Close asChild>
                <button className="mc-secondary">取消</button>
              </Dialog.Close>
              <button
                className="workshop-primary"
                disabled={busy || !form.title.trim()}
                onClick={() => void save()}
              >
                {busy ? (
                  <LoadingState variant="inline" label="正在保存…" />
                ) : editing ? (
                  "保存名称"
                ) : (
                  "创建并打开项目"
                )}{" "}
                <ArrowRight size={16} />
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={Boolean(deleting)}
        onOpenChange={(value) => {
          if (!value) setDeleting(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="mc-dialog-overlay" />
          <Dialog.Content className="mc-dialog mc-confirm">
            <Dialog.Title>删除特效项目？</Dialog.Title>
            <Dialog.Description>
              项目「{deleting?.title}
              」及其素材、导出文件会被删除。已交接到剪辑工坊的副本会保留。
            </Dialog.Description>
            <div className="mc-dialog-actions">
              <Dialog.Close asChild>
                <button className="mc-secondary">取消</button>
              </Dialog.Close>
              <button
                className="mc-danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                删除项目
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
