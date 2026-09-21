import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Download,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import {
  createProject,
  cancelExport,
  listExports,
  deleteProject,
  downloadProject,
  importProject,
  listProjects,
  renameProject,
} from "./api";
import { Modal } from "./Controls";
import type { Project } from "./types";
import "./workshop.css";
function Cover({ project }: { project: Project }) {
  const { url } = useApiBlobUrl(project.thumbnail ?? null);
  return (
    <div className="l2-project-cover">
      {url ? (
        <img src={url} alt={`${project.title}预览`} />
      ) : (
        <>
          <img src="/brand/live2d-workshop-mark.png" alt="" />
          <span>从分层立绘开始</span>
        </>
      )}
    </div>
  );
}
export function ProjectsPage({
  onOpen,
  readOnly = false,
}: {
  onOpen: (id: string) => void;
  readOnly?: boolean;
}) {
  const [projects, setProjects] = useState<Project[]>([]),
    [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(
      null,
    ),
    [selected, setSelected] = useState<Project | null>(null),
    [title, setTitle] = useState("未命名角色");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    listProjects()
      .then((r) => {
        if (active) setProjects(r.items);
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      if (dialog === "create") {
        const p = await createProject(title);
        onOpen(p.id);
      } else if (selected && dialog === "rename") {
        await renameProject(selected.id, selected.revision, title);
        setProjects((await listProjects()).items);
      } else if (selected && dialog === "delete") {
        const active = (await listExports(selected.id)).items.filter((t) =>
          ["queued", "running"].includes(t.status),
        );
        for (const task of active) await cancelExport(selected.id, task.id);
        const deadline = Date.now() + 30_000;
        while (
          (await listExports(selected.id)).items.some((t) =>
            ["queued", "running"].includes(t.status),
          )
        ) {
          if (Date.now() > deadline)
            throw new Error("任务仍在取消，请稍后重新删除项目");
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        await deleteProject(selected.id, selected.revision);
        setProjects((await listProjects()).items);
      }
      setDialog(null);
    });
  return (
    <section className="l2-projects">
      <WorkshopAppChrome
        title="角色项目"
        description="让静止的立绘，拥有表情与动作。"
        actions={
          !readOnly && (
            <>
              <button onClick={() => input.current?.click()} disabled={busy}>
                <Upload size={16} />
                导入工程
              </button>
              <button
                className="workshop-primary"
                onClick={() => {
                  setTitle("未命名角色");
                  setDialog("create");
                }}
              >
                <Plus size={16} />
                新建角色
              </button>
            </>
          )
        }
      />
      <input
        ref={input}
        type="file"
        hidden
        accept=".fpllive2d"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void run(async () => {
              onOpen((await importProject(file)).id);
            });
        }}
      />
      <div className="l2-project-tools">
        <label>
          <Search size={18} />
          <input
            aria-label="搜索角色项目"
            placeholder="搜索角色项目…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span>{projects.length} 个项目 · 本地工作空间</span>
      </div>
      {error && (
        <p role="alert" className="l2-error">
          {error}
        </p>
      )}
      {loading ? (
        <p>正在读取项目…</p>
      ) : (
        <div className="l2-project-grid">
          {projects
            .filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
            .map((p) => (
              <article key={p.id} className="l2-project-card">
                <button
                  className="l2-cover-button"
                  onClick={() => onOpen(p.id)}
                >
                  <Cover project={p} />
                </button>
                <div className="l2-project-info">
                  <h3>{p.title}</h3>
                  <small>{new Date(p.updatedAt).toLocaleString("zh-CN")}</small>
                  <footer>
                    <button onClick={() => onOpen(p.id)}>
                      打开项目 <ArrowRight size={15} />
                    </button>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger aria-label={`${p.title}项目菜单`}>
                        <MoreHorizontal size={18} />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="l2-menu">
                          <DropdownMenu.Item
                            onSelect={() =>
                              void run(() => downloadProject(p.id))
                            }
                          >
                            <Download size={14} />
                            导出工程
                          </DropdownMenu.Item>
                          {!readOnly && (
                            <>
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setSelected(p);
                                  setTitle(p.title);
                                  setDialog("rename");
                                }}
                              >
                                重命名
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setSelected(p);
                                  setDialog("delete");
                                }}
                              >
                                删除项目
                              </DropdownMenu.Item>
                            </>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </footer>
                </div>
              </article>
            ))}
          {!readOnly && (
            <button
              className="l2-new-project"
              onClick={() => {
                setTitle("未命名角色");
                setDialog("create");
              }}
            >
              <Plus size={30} />
              <strong>开始新的角色</strong>
              <span>分层素材 → 网格绑定 → 表情动画</span>
            </button>
          )}
          {!projects.length && (
            <p className="l2-empty">
              还没有角色项目。
              {readOnly ? "" : "新建项目，或导入 .fpllive2d 工程继续制作。"}
            </p>
          )}
        </div>
      )}
      <Modal
        title={
          dialog === "delete"
            ? "删除角色项目？"
            : dialog === "rename"
              ? "重命名角色"
              : "新建角色项目"
        }
        description={
          dialog === "delete"
            ? `“${selected?.title}”及其素材和导出结果都会删除；正在执行的导出会先取消。`
            : "创建可编辑的角色工程，随后导入分层 PSD 或透明 PNG。"
        }
        open={!!dialog}
        onClose={() => {
          if (!busy) setDialog(null);
        }}
      >
        {dialog !== "delete" && (
          <label className="l2-field">
            项目名称
            <input
              autoFocus
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="l2-error">
            {error}
          </p>
        )}
        <div className="l2-actions">
          <button disabled={busy} onClick={() => setDialog(null)}>
            取消
          </button>
          <button
            className="l2-primary"
            disabled={busy || !title.trim()}
            onClick={() => void save()}
          >
            {busy ? "处理中…" : dialog === "delete" ? "删除项目" : "保存"}
          </button>
        </div>
      </Modal>
    </section>
  );
}
