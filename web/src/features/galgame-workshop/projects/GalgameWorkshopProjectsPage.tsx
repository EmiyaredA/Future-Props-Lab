import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Maximize2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import { ProjectLibraryCard } from "@shared/ui/project-library";
import {
  createGalgameWorkshopProject,
  deleteGalgameWorkshopProject,
  getGalgameWorkshopProjects,
  patchGalgameWorkshopProject,
  type GalgameWorkshopProject,
} from "@features/galgame-workshop/api";
import "@features/galgame-workshop/galgameStyles";

const PROJECTS_KEY = ["galgame-workshop-projects"] as const;
type Editor =
  | { mode: "rename"; project: GalgameWorkshopProject; title: string }
  | { mode: "delete"; project: GalgameWorkshopProject }
  | null;

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "项目已在其他页面更新，列表已重新加载。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function GalgameWorkshopProjectsPage({
  onOpenProject = () => undefined,
}: {
  onOpenProject?: (projectId: string) => void;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor>(null);
  const [notice, setNotice] = useState("");
  const projectsQuery = useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: getGalgameWorkshopProjects,
  });
  const refresh = () =>
    void client.invalidateQueries({ queryKey: PROJECTS_KEY });
  const createMutation = useMutation({
    mutationFn: () => createGalgameWorkshopProject("未命名工程"),
    onSuccess: (project) => {
      client.setQueryData(
        PROJECTS_KEY,
        (current: { items: GalgameWorkshopProject[] } | undefined) => ({
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
      project: GalgameWorkshopProject;
      changes: Partial<Pick<GalgameWorkshopProject, "title" | "status">>;
    }) => patchGalgameWorkshopProject(project, changes),
    onSuccess: (updated) => {
      client.setQueryData(
        PROJECTS_KEY,
        (current: { items: GalgameWorkshopProject[] } | undefined) => ({
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
    mutationFn: deleteGalgameWorkshopProject,
    onSuccess: (_data, project) => {
      client.setQueryData(
        PROJECTS_KEY,
        (current: { items: GalgameWorkshopProject[] } | undefined) => ({
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
  const projects = projectsQuery.data?.items ?? [];
  const filtered = projects.filter((project) => {
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
    <section className="workshop-page workshop-projects-page galgame-library-page">
      <header className="workshop-page-header">
        <div>
          <h1>我的 Galgame 工程</h1>
          <p>管理故事工程，从剧本结构进入分支试玩与线路检查。</p>
        </div>
        <button
          className="workshop-primary"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          <Plus aria-hidden />
          {createMutation.isPending ? "正在创建…" : "新建工程"}
        </button>
      </header>
      <div className="workshop-toolbar workshop-toolbar-simple">
        <label>
          <Search aria-hidden />
          <input
            aria-label="搜索工程"
            placeholder="搜索工程名称…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
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
          <strong>正在读取工程</strong>
        </div>
      ) : projectsQuery.isError ? (
        <div className="workshop-state">
          <strong>工程暂时无法读取</strong>
          <button onClick={() => void projectsQuery.refetch()}>重新加载</button>
        </div>
      ) : filtered.length ? (
        <div className="workshop-project-grid">
          {filtered.map((project) => (
            <ProjectLibraryCard
              key={project.id}
              project={project}
              cover="galgame"
              coverTitle="故事工程"
              coverDescription="打开结构、试玩与检查"
              onOpen={() => onOpenProject(project.id)}
            >
              <div className="workshop-project-primary-actions">
                <button onClick={() => onOpenProject(project.id)}>
                  <Maximize2 aria-hidden />
                  打开
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
                    project.status === "draft" ? "标记为已完成" : "恢复为草稿"
                  }
                  onClick={() =>
                    patchMutation.mutate({
                      project,
                      changes: {
                        status:
                          project.status === "draft" ? "completed" : "draft",
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
            </ProjectLibraryCard>
          ))}
        </div>
      ) : (projectsQuery.data?.items.length ?? 0) === 0 ? (
        <div className="workshop-state workshop-empty">
          <span className="workshop-empty-icon">
            <Plus aria-hidden />
          </span>
          <strong>还没有 Galgame 工程</strong>
          <p>新建空白工程后将进入工程概览。</p>
          <button
            className="workshop-primary"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Plus aria-hidden />
            新建第一个工程
          </button>
        </div>
      ) : (
        <div className="workshop-state">
          <Search aria-hidden />
          <strong>没有找到匹配的工程</strong>
        </div>
      )}
      {editor ? (
        <div className="workshop-dialog-backdrop" role="presentation">
          <div
            className="workshop-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="galgame-project-editor-title"
          >
            <header>
              <div>
                <span>
                  {editor.mode === "rename" ? "编辑工程" : "删除工程"}
                </span>
                <h2 id="galgame-project-editor-title">
                  {editor.mode === "rename"
                    ? "重命名工程"
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
                  工程名称
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
                <p>删除工程会一并移除故事文档，此操作不可恢复。</p>
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
