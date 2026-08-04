import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FolderOpen,
  Maximize2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import {
  createVisualWorkshopProject,
  deleteVisualWorkshopProject,
  getVisualWorkshopProjects,
  patchVisualWorkshopProject,
  type VisualWorkshopProject,
  type VisualWorkshopProjectStatus,
} from "@features/visual-workshop/api";
import "@features/visual-workshop/visual-workshop.css";

const PROJECTS_KEY = ["visual-workshop-projects"] as const;
type Editor =
  | { mode: "rename"; project: VisualWorkshopProject; title: string }
  | { mode: "delete"; project: VisualWorkshopProject }
  | null;

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return "刚刚更新";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前更新`;
  if (elapsed < 86_400_000)
    return `${Math.floor(elapsed / 3_600_000)} 小时前更新`;
  return `${new Date(value).toLocaleDateString("zh-CN")} 更新`;
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "项目已在其他页面更新，列表已重新加载。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function VisualWorkshopProjectsPage({
  onOpenProject = () => undefined,
  onOpenAssets = () => undefined,
}: {
  onOpenProject?: (projectId: string) => void;
  onOpenAssets?: (projectId: string) => void;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | VisualWorkshopProjectStatus>(
    "all",
  );
  const [editor, setEditor] = useState<Editor>(null);
  const [notice, setNotice] = useState("");
  const projectsQuery = useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: getVisualWorkshopProjects,
  });
  const refresh = () =>
    void client.invalidateQueries({ queryKey: PROJECTS_KEY });
  const createMutation = useMutation({
    mutationFn: () => createVisualWorkshopProject("未命名项目", "canvas"),
    onSuccess: (project) => {
      client.setQueryData(
        PROJECTS_KEY,
        (current: { items: VisualWorkshopProject[] } | undefined) => ({
          items: [project, ...(current?.items ?? [])],
        }),
      );
      onOpenProject(project.id);
    },
    onError: (error) => setNotice(errorMessage(error)),
  });
  const patchMutation = useMutation({
    mutationFn: ({
      project,
      changes,
    }: {
      project: VisualWorkshopProject;
      changes: Partial<Pick<VisualWorkshopProject, "title" | "status">>;
    }) => patchVisualWorkshopProject(project, changes),
    onSuccess: (updated) => {
      client.setQueryData(
        PROJECTS_KEY,
        (current: { items: VisualWorkshopProject[] } | undefined) => ({
          items: [
            updated,
            ...(current?.items ?? []).filter((item) => item.id !== updated.id),
          ],
        }),
      );
      setEditor(null);
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      refresh();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteVisualWorkshopProject,
    onSuccess: (_data, project) => {
      client.setQueryData(
        PROJECTS_KEY,
        (current: { items: VisualWorkshopProject[] } | undefined) => ({
          items: (current?.items ?? []).filter(
            (item) => item.id !== project.id,
          ),
        }),
      );
      setEditor(null);
    },
    onError: (error) => {
      setNotice(errorMessage(error));
      refresh();
    },
  });
  const filtered = (projectsQuery.data?.items ?? []).filter((project) => {
    if (status !== "all" && project.status !== status) return false;
    return project.title
      .toLocaleLowerCase("zh-CN")
      .includes(query.trim().toLocaleLowerCase("zh-CN"));
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (editor?.mode === "rename")
      patchMutation.mutate({
        project: editor.project,
        changes: { title: editor.title },
      });
  };
  const pending =
    createMutation.isPending ||
    patchMutation.isPending ||
    deleteMutation.isPending;

  return (
    <section className="workshop-page workshop-projects-page">
      <header className="workshop-page-header">
        <div>
          <h1>我的创作项目</h1>
          <p>所有项目统一使用沉浸式创作画布。</p>
        </div>
        <button
          className="workshop-primary"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          <Plus aria-hidden />
          {createMutation.isPending ? "正在创建…" : "新建项目"}
        </button>
      </header>
      <div className="workshop-toolbar workshop-toolbar-simple">
        <label>
          <Search aria-hidden />
          <input
            aria-label="搜索项目"
            placeholder="搜索项目名称…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="workshop-filters" aria-label="项目状态">
          {(["all", "draft", "completed"] as const).map((value) => (
            <button
              key={value}
              className={status === value ? "active" : ""}
              onClick={() => setStatus(value)}
            >
              {value === "all" ? "全部" : value === "draft" ? "草稿" : "已完成"}
            </button>
          ))}
        </div>
      </div>
      {notice ? (
        <div className="workshop-notice" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X aria-hidden />
          </button>
        </div>
      ) : null}
      {projectsQuery.isLoading ? (
        <div className="workshop-state">
          <RefreshCcw className="spinning" aria-hidden />
          <strong>正在读取项目</strong>
        </div>
      ) : projectsQuery.isError ? (
        <div className="workshop-state">
          <strong>项目暂时无法读取</strong>
          <button onClick={() => void projectsQuery.refetch()}>重新加载</button>
        </div>
      ) : filtered.length ? (
        <div className="workshop-project-grid">
          {filtered.map((project) => (
            <article className="workshop-project-card" key={project.id}>
              <button
                className="workshop-project-cover canvas"
                onClick={() => onOpenProject(project.id)}
              >
                <span className="workshop-project-cover-content">
                  <span className="workshop-project-cover-label">
                    <strong>创作画布</strong>
                    <small>点击进入项目</small>
                  </span>
                </span>
              </button>
              <div className="workshop-project-copy">
                <div className="workshop-project-meta">
                  <span className={`workshop-status ${project.status}`}>
                    {project.status === "draft" ? "草稿" : "已完成"}
                  </span>
                  <small>{relativeTime(project.updated_at)}</small>
                </div>
                <h2>{project.title}</h2>
                <div className="workshop-project-actions">
                  <div className="workshop-project-primary-actions">
                    <button onClick={() => onOpenProject(project.id)}>
                      <Maximize2 aria-hidden />
                      画布
                    </button>
                    <button
                      aria-label="素材库"
                      onClick={() => onOpenAssets(project.id)}
                    >
                      <FolderOpen aria-hidden />
                      素材
                    </button>
                  </div>
                  <div className="workshop-project-secondary-actions">
                    <button
                      aria-label="重命名"
                      title="重命名"
                      onClick={() =>
                        setEditor({
                          mode: "rename",
                          project,
                          title: project.title,
                        })
                      }
                    >
                      <Pencil aria-hidden />
                    </button>
                    <button
                      aria-label={project.status === "draft" ? "完成" : "恢复"}
                      title={
                        project.status === "draft"
                          ? "标记为已完成"
                          : "恢复为草稿"
                      }
                      onClick={() =>
                        patchMutation.mutate({
                          project,
                          changes: {
                            status:
                              project.status === "draft"
                                ? "completed"
                                : "draft",
                          },
                        })
                      }
                    >
                      {project.status === "draft" ? (
                        <Check aria-hidden />
                      ) : (
                        <RefreshCcw aria-hidden />
                      )}
                    </button>
                    <button
                      className="danger"
                      aria-label="删除"
                      title="删除"
                      onClick={() => setEditor({ mode: "delete", project })}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (projectsQuery.data?.items.length ?? 0) === 0 ? (
        <div className="workshop-state workshop-empty">
          <span className="workshop-empty-icon">
            <Plus aria-hidden />
          </span>
          <strong>还没有创作项目</strong>
          <p>新建后将直接进入画布。</p>
          <button
            className="workshop-primary"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Plus aria-hidden />
            新建第一个项目
          </button>
        </div>
      ) : (
        <div className="workshop-state">
          <Search aria-hidden />
          <strong>没有找到匹配的项目</strong>
        </div>
      )}
      {editor ? (
        <div className="workshop-dialog-backdrop" role="presentation">
          <div
            className="workshop-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-editor-title"
          >
            <header>
              <div>
                <span>
                  {editor.mode === "rename" ? "编辑项目" : "删除项目"}
                </span>
                <h2 id="project-editor-title">
                  {editor.mode === "rename"
                    ? "重命名项目"
                    : `删除“${editor.project.title}”？`}
                </h2>
              </div>
              <button
                disabled={pending}
                aria-label="关闭"
                onClick={() => setEditor(null)}
              >
                <X aria-hidden />
              </button>
            </header>
            {editor.mode === "rename" ? (
              <form onSubmit={submit}>
                <label>
                  项目名称
                  <input
                    autoFocus
                    required
                    maxLength={120}
                    value={editor.title}
                    onChange={(event) =>
                      setEditor({ ...editor, title: event.target.value })
                    }
                  />
                </label>
                <div className="workshop-dialog-actions">
                  <button type="button" onClick={() => setEditor(null)}>
                    取消
                  </button>
                  <button
                    className="workshop-primary"
                    disabled={pending || !editor.title.trim()}
                  >
                    保存名称
                  </button>
                </div>
              </form>
            ) : (
              <div className="workshop-delete-copy">
                <p>
                  删除项目时会一并删除项目私有素材和文件夹；文件管理中的源文件不会受到影响。
                </p>
                <div>
                  <button onClick={() => setEditor(null)}>取消</button>
                  <button
                    className="danger"
                    disabled={pending}
                    onClick={() => deleteMutation.mutate(editor.project)}
                  >
                    确认删除
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
