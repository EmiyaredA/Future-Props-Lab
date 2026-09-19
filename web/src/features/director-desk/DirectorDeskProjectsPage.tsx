import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Maximize2, Pencil, Plus, RefreshCcw, Search, Trash2, Upload, X } from "lucide-react";
import { ApiError } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { ProjectEditorDialog, ProjectLibraryCard } from "@shared/ui/project-library";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { createDirectorProject, deleteDirectorProject, listDirectorProjects, patchDirectorProject } from "./api";
import { exportDirectorFile, importDirectorFile } from "./directorPackage";
import { directorDeskKeys } from "./queryKeys";
import "./director-desk-projects.css";

function message(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "项目已在其他页面更新，列表已重新加载。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

type DirectorListItem = {
  id: string;
  title: string;
  revision: number;
  updated_at: string;
};

export function DirectorDeskProjectsPage({
  readOnly,
  onOpen,
}: {
  readOnly: boolean;
  onOpen: (projectId: string) => void;
}) {
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [rename, setRename] = useState<{ project: DirectorListItem; title: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DirectorListItem | null>(null);
  const projects = useQuery({
    queryKey: directorDeskKeys.projects(query),
    queryFn: ({ signal }) => listDirectorProjects(query, signal),
  });
  const create = useMutation({
    mutationFn: () => createDirectorProject("未命名预演"),
    onSuccess: (project) => {
      void client.invalidateQueries({ queryKey: directorDeskKeys.all });
      onOpen(project.id);
    },
    onError: (error) => setNotice(message(error)),
  });
  const updateTitle = useMutation({
    mutationFn: (input: { project: DirectorListItem; title: string }) =>
      patchDirectorProject(input.project.id, {
        title: input.title,
        expected_revision: input.project.revision,
      }),
    onSuccess: () => {
      setRename(null);
      void client.invalidateQueries({ queryKey: directorDeskKeys.all });
    },
    onError: (error) => {
      setRename(null);
      setNotice(message(error));
      void client.invalidateQueries({ queryKey: directorDeskKeys.all });
    },
  });
  const remove = useMutation({
    mutationFn: (project: DirectorListItem) => deleteDirectorProject(project.id, project.revision),
    onSuccess: () => {
      setPendingDelete(null);
      void client.invalidateQueries({ queryKey: directorDeskKeys.all });
    },
    onError: (error) => {
      setPendingDelete(null);
      setNotice(message(error));
      void client.invalidateQueries({ queryKey: directorDeskKeys.all });
    },
  });
  const importing = useMutation({
    mutationFn: importDirectorFile,
    onSuccess: (id) => {
      void client.invalidateQueries({ queryKey: directorDeskKeys.all });
      onOpen(id);
    },
    onError: (error) => setNotice(message(error)),
  });
  const exporting = useMutation({
    mutationFn: (project: DirectorListItem) => exportDirectorFile(project.id, project.title),
    onError: (error) => setNotice(message(error)),
  });
  const items = projects.data?.items ?? [];
  return (
    <section className="workshop-page workshop-projects-page dd-projects">
      <WorkshopAppChrome
        title="我的预演工程"
        description="建立预演工程，打开后排布场景、走位和运镜。"
        actions={
          readOnly ? null : (
            <>
              <button
                type="button"
                className="workshop-secondary"
                disabled={importing.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <Upload aria-hidden />
                {importing.isPending ? "正在导入…" : "导入"}
              </button>
              <button
                type="button"
                className="workshop-primary"
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                <Plus aria-hidden />
                {create.isPending ? "正在创建…" : "新建预演"}
              </button>
              <input
                ref={fileRef}
                className="project-snapshot-file-input"
                type="file"
                accept=".director,.json,application/json"
                aria-label="导入预演工程"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) importing.mutate(file);
                }}
              />
            </>
          )
        }
      />
      <div className="workshop-toolbar workshop-toolbar-simple">
        <label>
          <Search aria-hidden />
          <input
            aria-label="搜索预演工程"
            placeholder="搜索预演工程…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {notice ? (
        <div className="workshop-notice" role="status">
          {notice}
          <button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>
            <X aria-hidden />
          </button>
        </div>
      ) : null}
      {projects.isLoading ? (
        <div className="workshop-state">
          <RefreshCcw className="spinning" aria-hidden />
          <strong>正在读取预演工程</strong>
        </div>
      ) : projects.isError ? (
        <div className="workshop-state">
          <strong>预演工程暂时无法读取</strong>
          <button type="button" onClick={() => void projects.refetch()}>
            重新加载
          </button>
        </div>
      ) : items.length ? (
        <div className="workshop-project-grid" aria-live="polite">
          {items.map((project) => (
            <ProjectLibraryCard
              key={project.id}
              project={{ id: project.id, title: project.title, updated_at: project.updated_at }}
              metadata={<span className="workshop-status draft">预演</span>}
              cover="director"
              coverTitle="三维预演"
              coverDescription="点击进入布景"
              onOpen={() => onOpen(project.id)}
            >
              <div className="workshop-project-primary-actions">
                <button type="button" onClick={() => onOpen(project.id)}>
                  <Maximize2 aria-hidden />
                  布景
                </button>
                <button
                  type="button"
                  disabled={exporting.isPending}
                  onClick={() => exporting.mutate(project)}
                >
                  <Download aria-hidden />
                  导出
                </button>
              </div>
              {readOnly ? null : (
                <div className="workshop-project-secondary-actions">
                  <button
                    type="button"
                    aria-label={`重命名${project.title}`}
                    title="重命名"
                    onClick={() => setRename({ project, title: project.title })}
                  >
                    <Pencil aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    aria-label={`删除${project.title}`}
                    title="删除"
                    onClick={() => setPendingDelete(project)}
                  >
                    <Trash2 aria-hidden />
                  </button>
                </div>
              )}
            </ProjectLibraryCard>
          ))}
        </div>
      ) : (
        <div className="workshop-state">
          <strong>{query ? "没有匹配的预演工程" : "还没有预演工程"}</strong>
          <span>
            {query ? "换个关键词试试，或清空搜索查看全部工程。" : "新建工程后即可进入三维预演。"}
          </span>
          {query ? (
            <button type="button" onClick={() => setQuery("")}>
              清空搜索
            </button>
          ) : readOnly ? null : (
            <button type="button" className="workshop-primary" onClick={() => create.mutate()}>
              <Plus aria-hidden /> 新建预演
            </button>
          )}
        </div>
      )}
      {rename ? (
        <ProjectEditorDialog
          editor={{ mode: "rename", project: rename.project, title: rename.title }}
          noun="预演工程"
          pending={updateTitle.isPending}
          deleteDescription=""
          onTitleChange={(title) => setRename({ ...rename, title })}
          onCancel={() => setRename(null)}
          onRename={() => {
            const title = rename.title.trim();
            if (!title) return;
            updateTitle.mutate({ project: rename.project, title });
          }}
          onDelete={() => undefined}
        />
      ) : null}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除预演工程"
        description={pendingDelete ? `删除「${pendingDelete.title}」后不能恢复。` : ""}
        confirmLabel="删除"
        pending={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
        }}
      />
    </section>
  );
}
