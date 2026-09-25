import { useEffect, useRef, useState } from "react";
import {
  Download,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { ProjectLibraryCard } from "@shared/ui/project-library";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { AMADEUS_PACKAGE_URL } from "@shared/live2d/bundled";
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

function ProjectThumbnail({ href }: { href: string }) {
  const { url } = useApiBlobUrl(href);
  if (!url) return null;
  return <img className="l2-project-thumb" src={url} alt="" />;
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
  const filtered = projects.filter((p) =>
    p.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="workshop-page workshop-projects-page l2-projects">
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
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const response = await fetch(AMADEUS_PACKAGE_URL);
                    if (!response.ok)
                      throw new Error("Amadeus 模型文件无法读取");
                    const file = new File(
                      [await response.blob()],
                      "Amadeus.fpllive2d",
                      { type: "application/zip" },
                    );
                    onOpen((await importProject(file)).id);
                  })
                }
              >
                <Download size={16} />
                导入 Amadeus 模型
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
      <div className="workshop-toolbar workshop-toolbar-simple l2-project-tools">
        <label>
          <Search size={18} />
          <input
            aria-label="搜索角色项目"
            placeholder="搜索角色项目…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="l2-error">
          {error}
        </p>
      )}
      {loading ? (
        <div className="workshop-state">
          <strong>正在读取项目…</strong>
        </div>
      ) : filtered.length ? (
        <div className="workshop-project-grid" aria-live="polite">
          {filtered.map((p) => (
            <ProjectLibraryCard
              key={p.id}
              project={{
                id: p.id,
                title: p.title,
                updated_at: p.updatedAt,
              }}
              cover="live2d"
              coverTitle="角色工程"
              coverDescription="导入分层立绘后开始绑定"
              coverContent={
                p.thumbnail ? (
                  <ProjectThumbnail href={p.thumbnail} />
                ) : undefined
              }
              onOpen={() => onOpen(p.id)}
            >
              <div className="workshop-project-primary-actions">
                <button onClick={() => onOpen(p.id)}>
                  <Maximize2 size={15} />
                  打开
                </button>
              </div>
              <div className="workshop-project-secondary-actions">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger aria-label={`${p.title}项目菜单`}>
                    <MoreHorizontal size={18} />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="l2-menu">
                      <DropdownMenu.Item
                        onSelect={() => void run(() => downloadProject(p.id))}
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
                            <Pencil size={14} />
                            重命名
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            onSelect={() => {
                              setSelected(p);
                              setDialog("delete");
                            }}
                          >
                            <Trash2 size={14} />
                            删除项目
                          </DropdownMenu.Item>
                        </>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </ProjectLibraryCard>
          ))}
        </div>
      ) : (
        <div className="workshop-state">
          <strong>{query ? "没有匹配的角色项目" : "还没有角色项目"}</strong>
          <span>
            {query
              ? "换个关键词试试，或清空搜索查看全部项目。"
              : readOnly
                ? "当前空间暂无可浏览的角色工程。"
                : "新建项目，或导入 .fpllive2d 工程继续制作。"}
          </span>
          {query ? (
            <button type="button" onClick={() => setQuery("")}>
              清空搜索
            </button>
          ) : (
            !readOnly && (
              <button
                type="button"
                className="workshop-primary"
                onClick={() => {
                  setTitle("未命名角色");
                  setDialog("create");
                }}
              >
                <Plus size={16} />
                新建角色
              </button>
            )
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
            : dialog === "rename"
              ? "更新项目显示名称，不影响已导入的分层素材。"
              : "创建可编辑的角色工程，随后导入分层 PSD 或透明 PNG。"
        }
        open={!!dialog}
        onClose={() => {
          if (!busy) setDialog(null);
        }}
      >
        <form
          className="l2-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && (dialog === "delete" || title.trim())) void save();
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
            <button
              type="button"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              取消
            </button>
            <button
              type="submit"
              className={dialog === "delete" ? "l2-danger-fill" : "l2-primary"}
              disabled={busy || (dialog !== "delete" && !title.trim())}
            >
              {busy
                ? "处理中…"
                : dialog === "delete"
                  ? "删除项目"
                  : dialog === "rename"
                    ? "保存名称"
                    : "创建项目"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
