import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  createVideoEditorProject,
  deleteVideoEditorProject,
  listVideoEditorProjects,
  patchVideoEditorProject,
} from "./api";
import type { VideoEditorProject } from "./types";
import { videoEditorQueryKeys } from "./queryKeys";
import "./video-editor.css";

export function VideoEditorProjectsPage({
  onOpenProject,
}: {
  onOpenProject: (projectId: string) => void;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<VideoEditorProject | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<VideoEditorProject | null>(null);
  const projects = useQuery({
    queryKey: videoEditorQueryKeys.projects,
    queryFn: listVideoEditorProjects,
  });
  const refresh = () =>
    void client.invalidateQueries({ queryKey: videoEditorQueryKeys.projects });
  const create = useMutation({
    mutationFn: () => createVideoEditorProject(),
    onSuccess: (project) => {
      refresh();
      onOpenProject(project.id);
    },
  });
  const rename = useMutation({
    mutationFn: () =>
      patchVideoEditorProject(editing as VideoEditorProject, { title }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteVideoEditorProject(deleting as VideoEditorProject),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const items = (projects.data?.items ?? []).filter((project) =>
    project.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="workshop-page ve-projects">
      <header className="workshop-page-header">
        <div>
          <h1>视频剪辑项目</h1>
          <p>素材快照、二维多轨时间轴与确定性 FFmpeg 导出。</p>
        </div>
        <button
          className="workshop-primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus aria-hidden /> 新建剪辑
        </button>
      </header>
      <div className="ve-project-search">
        <Search aria-hidden />
        <input
          aria-label="搜索剪辑项目"
          placeholder="搜索项目…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {projects.isLoading ? (
        <div className="ve-state">正在读取项目…</div>
      ) : null}
      {projects.isError ? <div className="ve-state">项目读取失败</div> : null}
      <div className="ve-project-grid">
        {items.map((project) => (
          <article className="ve-project-card" key={project.id}>
            <button
              className="ve-project-cover"
              onClick={() => onOpenProject(project.id)}
            >
              <Film aria-hidden />
              <span>16:9 · 1080p30</span>
            </button>
            <div>
              <strong>{project.title}</strong>
              <small>
                {project.status === "draft" ? "剪辑中" : "已完成"} · 修订{" "}
                {project.revision}
              </small>
            </div>
            <footer>
              <button
                aria-label="重命名"
                onClick={() => {
                  setEditing(project);
                  setTitle(project.title);
                }}
              >
                <Pencil aria-hidden />
              </button>
              <button aria-label="删除" onClick={() => setDeleting(project)}>
                <Trash2 aria-hidden />
              </button>
              <button onClick={() => onOpenProject(project.id)}>
                打开时间轴
              </button>
            </footer>
          </article>
        ))}
      </div>
      {editing ? (
        <div className="ve-dialog-backdrop" role="presentation">
          <form
            className="ve-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              rename.mutate();
            }}
          >
            <h2>重命名项目</h2>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <footer>
              <button type="button" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="primary" disabled={!title.trim()}>
                保存
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {deleting ? (
        <div className="ve-dialog-backdrop" role="presentation">
          <section className="ve-dialog" role="dialog" aria-modal="true">
            <h2>删除“{deleting.title}”？</h2>
            <p>项目素材快照、代理和历史输出都会被清理。</p>
            <footer>
              <button onClick={() => setDeleting(null)}>取消</button>
              <button className="danger" onClick={() => remove.mutate()}>
                确认删除
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
