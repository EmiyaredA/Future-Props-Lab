import { LoadingState } from "@shared/ui/LoadingState";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useState } from "react";
import {
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
  ProjectEditorDialog,
  ProjectLibraryCard,
  ProjectSnapshotCardActions,
  ProjectSnapshotImportButton,
  useProjectLibraryController,
} from "@shared/ui/project-library";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import {
  createVideoEditorProject,
  deleteVideoEditorProject,
  exportVideoEditorProjectSnapshot,
  importVideoEditorProjectSnapshot,
  listVideoEditorProjects,
  openVideoEditorProjectFolder,
  patchVideoEditorProject,
} from "./api";
import type { VideoEditorProject } from "./types";
import { videoEditorQueryKeys } from "./queryKeys";
import "./video-editor.css";
import "./video-editor-projects.css";

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "项目已在其他页面更新，列表已重新加载。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function VideoEditorProjectsPage({
  onOpenProject,
}: {
  onOpenProject: (projectId: string) => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [query, setQuery] = useState("");
  const {
    projectsQuery: projects,
    editor,
    setEditor,
    notice,
    setNotice,
    createMutation: create,
    patchMutation: rename,
    deleteMutation: remove,
    importMutation: importSnapshot,
    exportMutation: exportSnapshot,
    openFolderMutation: openFolder,
    pending,
  } = useProjectLibraryController<VideoEditorProject>({
    queryKey: videoEditorQueryKeys.projects,
    listProjects: listVideoEditorProjects,
    createProject: () => createVideoEditorProject(),
    patchProject: ({ project, changes }) =>
      patchVideoEditorProject(project, changes),
    deleteProject: deleteVideoEditorProject,
    importSnapshot: importVideoEditorProjectSnapshot,
    exportSnapshot: (project) =>
      runTransfer((onProgress) =>
        exportVideoEditorProjectSnapshot(project.id, { onProgress }),
      ),
    openFolder: (project) => openVideoEditorProjectFolder(project.id),
    onOpenProject,
    errorMessage,
  });
  const allItems = projects.data?.items ?? [];
  const items = allItems.filter((project) =>
    project.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="workshop-page workshop-projects-page ve-projects">
      <TransferFeedback progress={activeTransferProgress} />

      <WorkshopAppChrome
        title="我的视频剪辑工程"
        description="管理剪辑工程，从素材组织进入时间轴、分段与成片导出。"
        actions={
          <>
            <ProjectSnapshotImportButton
              pending={importSnapshot.isPending}
              onImport={(file) => importSnapshot.mutate(file)}
            />
            <button
              className="workshop-primary"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus aria-hidden /> {create.isPending ? "正在创建…" : "新建剪辑"}
            </button>
          </>
        }
      />
      <div className="workshop-toolbar workshop-toolbar-simple">
        <label>
          <Search aria-hidden />
          <input
            aria-label="搜索剪辑项目"
            placeholder="搜索剪辑工程…"
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
      {projects.isLoading ? (
        <div className="workshop-state">
          <RefreshCcw className="spinning" aria-hidden />
          <LoadingState label="正在读取剪辑工程" variant="inline" />
        </div>
      ) : projects.isError ? (
        <div className="workshop-state">
          <strong>剪辑工程暂时无法读取</strong>
          <button onClick={() => void projects.refetch()}>重新加载</button>
        </div>
      ) : items.length ? (
        <div className="workshop-project-grid" aria-live="polite">
          {items.map((project) => (
            <ProjectLibraryCard
              key={project.id}
              project={{
                id: project.id,
                title: project.title,
                status: project.status,
                updated_at: project.updatedAt,
              }}
              cover="video"
              coverTitle="剪辑工程"
              coverDescription="打开时间轴、分段与导出"
              onOpen={() => onOpenProject(project.id)}
            >
              <div className="workshop-project-primary-actions">
                <button onClick={() => onOpenProject(project.id)}>
                  <Maximize2 aria-hidden />
                  打开
                </button>
              </div>
              <div className="workshop-project-secondary-actions">
                <ProjectSnapshotCardActions
                  title={project.title}
                  exporting={
                    exportSnapshot.isPending &&
                    exportSnapshot.variables?.id === project.id
                  }
                  opening={
                    openFolder.isPending &&
                    openFolder.variables?.id === project.id
                  }
                  onExport={() => exportSnapshot.mutate(project)}
                  onOpenFolder={() => openFolder.mutate(project)}
                />
                <button
                  aria-label={`重命名“${project.title}”`}
                  title="重命名"
                  onClick={() =>
                    setEditor({ mode: "rename", project, title: project.title })
                  }
                >
                  <Pencil aria-hidden />
                </button>
                <button
                  className="danger"
                  aria-label={`删除“${project.title}”`}
                  title="删除"
                  onClick={() => setEditor({ mode: "delete", project })}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
            </ProjectLibraryCard>
          ))}
        </div>
      ) : (
        <div className="workshop-state">
          <strong>{query ? "没有匹配的剪辑工程" : "还没有剪辑工程"}</strong>
          <span>
            {query
              ? "换个关键词试试，或清空搜索查看全部工程。"
              : "新建工程后即可导入素材并搭建多轨时间轴。"}
          </span>
          {query ? (
            <button type="button" onClick={() => setQuery("")}>
              清空搜索
            </button>
          ) : (
            <button
              type="button"
              className="workshop-primary"
              onClick={() => create.mutate()}
            >
              <Plus aria-hidden /> 新建剪辑
            </button>
          )}
        </div>
      )}
      {editor ? (
        <ProjectEditorDialog
          editor={editor}
          noun="剪辑工程"
          pending={pending}
          deleteDescription="项目素材快照、代理和历史输出都会被清理，此操作不可恢复。"
          onTitleChange={(title) =>
            editor.mode === "rename" && setEditor({ ...editor, title })
          }
          onCancel={() => setEditor(null)}
          onRename={() =>
            editor.mode === "rename" &&
            rename.mutate({
              project: editor.project,
              changes: { title: editor.title },
            })
          }
          onDelete={() => remove.mutate(editor.project)}
        />
      ) : null}
    </section>
  );
}
