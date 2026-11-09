import type { ReactNode } from "react";
import { LoadingState } from "@shared/ui/LoadingState";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { ProjectCertification } from "@features/accounts";
import { useState } from "react";
import {
  Check,
  Maximize2,
  Pencil,
  Plus,
  Search,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import {
  ProjectEditorDialog,
  ProjectLibraryCard,
  ProjectSnapshotCardActions,
  ProjectSnapshotImportButton,
  useProjectLibraryController,
} from "@shared/ui/project-library";
import {
  WorkshopAppChrome,
  WorkshopSearch,
} from "@shared/ui/WorkshopAppChrome";
import {
  createGalgameWorkshopProject,
  deleteGalgameWorkshopProject,
  exportGalgameWorkshopProjectSnapshot,
  getGalgameWorkshopProjects,
  importGalgameWorkshopProjectSnapshot,
  openGalgameWorkshopProjectFolder,
  patchGalgameWorkshopProject,
  type GalgameWorkshopProject,
} from "@features/galgame-workshop/api";
import "@features/galgame-workshop/galgameStyles";
import { galgameQueryKeys } from "@features/galgame-workshop/queryKeys";

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "项目已在其他页面更新，列表已重新加载。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function GalgameWorkshopProjectsPage({
  utilities,
  onOpenProject = () => undefined,
}: {
  utilities?: ReactNode;
  onOpenProject?: (projectId: string) => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [query, setQuery] = useState("");
  const {
    projectsQuery,
    editor,
    setEditor,
    notice,
    setNotice,
    createMutation,
    patchMutation,
    deleteMutation,
    importMutation,
    exportMutation,
    openFolderMutation,
    pending,
  } = useProjectLibraryController<GalgameWorkshopProject>({
    queryKey: galgameQueryKeys.projects,
    listProjects: getGalgameWorkshopProjects,
    createProject: () => createGalgameWorkshopProject("未命名工程"),
    patchProject: ({ project, changes }) =>
      patchGalgameWorkshopProject(project, changes),
    deleteProject: deleteGalgameWorkshopProject,
    importSnapshot: importGalgameWorkshopProjectSnapshot,
    exportSnapshot: (project) =>
      runTransfer((onProgress) =>
        exportGalgameWorkshopProjectSnapshot(project.id, { onProgress }),
      ),
    openFolder: (project) => openGalgameWorkshopProjectFolder(project.id),
    onOpenProject,
    errorMessage,
  });
  const projects = projectsQuery.data?.items ?? [];
  const filtered = projects.filter((project) => {
    return project.title
      .toLocaleLowerCase("zh-CN")
      .includes(query.trim().toLocaleLowerCase("zh-CN"));
  });

  return (
    <section className="workshop-page workshop-projects-page galgame-library-page">
      <TransferFeedback progress={activeTransferProgress} />

      <WorkshopAppChrome
        utilities={utilities}
        showThemeToggle={false}
        title="我的 Galgame 工程"
        actions={
          <>
            <WorkshopSearch
              label="搜索工程"
              placeholder="搜索工程名称…"
              value={query}
              onChange={setQuery}
            />

            <ProjectSnapshotImportButton
              pending={importMutation.isPending}
              onImport={(file) => importMutation.mutate(file)}
            />
            <button
              className="workshop-primary"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              <Plus aria-hidden />
              {createMutation.isPending ? "正在创建…" : "新建工程"}
            </button>
          </>
        }
      />
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
          <LoadingState label="正在读取工程" variant="inline" />
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
              metadata={
                project.is_official ? (
                  <span className="workshop-status completed">官方作品</span>
                ) : undefined
              }
              cover="galgame"
              coverTitle="故事工程"
              onOpen={() => onOpenProject(project.id)}
            >
              <div className="workshop-project-primary-actions">
                <button onClick={() => onOpenProject(project.id)}>
                  <Maximize2 aria-hidden />
                  打开
                </button>
              </div>
              <div className="workshop-project-secondary-actions">
                <ProjectCertification
                  kind="galgame"
                  project={project}
                  queryKey={galgameQueryKeys.projects}
                />
                <ProjectSnapshotCardActions
                  title={project.title}
                  exporting={
                    exportMutation.isPending &&
                    exportMutation.variables?.id === project.id
                  }
                  opening={
                    openFolderMutation.isPending &&
                    openFolderMutation.variables?.id === project.id
                  }
                  onExport={() => exportMutation.mutate(project)}
                  onOpenFolder={() => openFolderMutation.mutate(project)}
                />
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
        <ProjectEditorDialog
          editor={editor}
          noun="工程"
          pending={pending}
          deleteDescription="删除工程会一并移除故事文档，此操作不可恢复。"
          onTitleChange={(title) =>
            editor.mode === "rename" && setEditor({ ...editor, title })
          }
          onCancel={() => setEditor(null)}
          onRename={() =>
            editor.mode === "rename" &&
            patchMutation.mutate({
              project: editor.project,
              changes: { title: editor.title },
            })
          }
          onDelete={() => deleteMutation.mutate(editor.project)}
        />
      ) : null}
    </section>
  );
}
