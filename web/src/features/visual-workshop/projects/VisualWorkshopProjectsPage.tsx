import type { ReactNode } from "react";
import { LoadingState } from "@shared/ui/LoadingState";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { ProjectCertification } from "@features/accounts";
import { useState } from "react";
import {
  FolderOpen,
  Maximize2,
  Pencil,
  Plus,
  Search,
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
  createVisualWorkshopProject,
  deleteVisualWorkshopProject,
  exportVisualWorkshopProjectSnapshot,
  getVisualWorkshopProjects,
  importVisualWorkshopProjectSnapshot,
  openVisualWorkshopProjectFolder,
  patchVisualWorkshopProject,
  type VisualWorkshopProject,
} from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import "@features/visual-workshop/visual-workshop.css";

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "项目已在其他页面更新，列表已重新加载。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function VisualWorkshopProjectsPage({
  utilities,
  onOpenProject = () => undefined,
  onOpenAssets = () => undefined,
}: {
  utilities?: ReactNode;
  onOpenProject?: (projectId: string) => void;
  onOpenAssets?: (projectId: string) => void;
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
  } = useProjectLibraryController<VisualWorkshopProject>({
    queryKey: visualWorkshopQueryKeys.projects,
    listProjects: getVisualWorkshopProjects,
    createProject: () => createVisualWorkshopProject("未命名项目", "canvas"),
    patchProject: ({ project, changes }) =>
      patchVisualWorkshopProject(project, changes),
    deleteProject: deleteVisualWorkshopProject,
    importSnapshot: importVisualWorkshopProjectSnapshot,
    exportSnapshot: (project) =>
      runTransfer((onProgress) =>
        exportVisualWorkshopProjectSnapshot(project.id, { onProgress }),
      ),
    openFolder: (project) => openVisualWorkshopProjectFolder(project.id),
    onOpenProject,
    errorMessage,
  });
  const search = query.trim().toLocaleLowerCase("zh-CN");
  const filtered = (projectsQuery.data?.items ?? []).filter((project) =>
    project.title.toLocaleLowerCase("zh-CN").includes(search),
  );

  return (
    <section className="workshop-page workshop-projects-page">
      <TransferFeedback progress={activeTransferProgress} />

      <WorkshopAppChrome
        utilities={utilities}
        showThemeToggle={false}
        title="我的创作项目"
        actions={
          <>
            <WorkshopSearch
              label="搜索项目"
              placeholder="搜索项目名称…"
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
              {createMutation.isPending ? "正在创建…" : "新建项目"}
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
          <LoadingState label="正在读取项目" variant="inline" />
        </div>
      ) : projectsQuery.isError ? (
        <div className="workshop-state">
          <strong>项目暂时无法读取</strong>
          <button onClick={() => void projectsQuery.refetch()}>重新加载</button>
        </div>
      ) : filtered.length ? (
        <div className="workshop-project-grid">
          {filtered.map((project) => (
            <ProjectLibraryCard
              key={project.id}
              project={{
                id: project.id,
                title: project.title,
                updated_at: project.updated_at,
              }}
              metadata={
                project.is_official ? (
                  <span className="workshop-status completed">官方作品</span>
                ) : undefined
              }
              cover="canvas"
              coverTitle="创作画布"
              onOpen={() => onOpenProject(project.id)}
            >
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
                <ProjectCertification
                  kind="visual"
                  project={project}
                  queryKey={visualWorkshopQueryKeys.projects}
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
        <ProjectEditorDialog
          editor={editor}
          noun="项目"
          pending={pending}
          deleteDescription="删除项目时会一并删除项目私有素材和文件夹；文件管理中的源文件不会受到影响。"
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
