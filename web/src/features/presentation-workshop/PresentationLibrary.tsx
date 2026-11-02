import { LoadingState } from "@shared/ui/LoadingState";
import { ImportButton } from "./exchange/ImportButton";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Presentation,
  Search,
  Copy,
  Pencil,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  saveProject,
} from "./api";
import { presentationKeys } from "./queryKeys";
import { PresentationMenu } from "./PresentationMenu";
import { newDeck } from "./templates";
import { PresentationPreviewCard } from "./PresentationPreviewCard";
import type { ProjectSummary } from "./types";

export function PresentationLibrary({
  onOpen,
  readOnly,
}: {
  onOpen: (id: string) => void;
  readOnly: boolean;
}) {
  const [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [rename, setRename] = useState<ProjectSummary | "new" | null>(null),
    [remove, setRemove] = useState<ProjectSummary | null>(null);
  const [initialLayout, setInitialLayout] = useState("cover");
  const startNew = (layout = "cover") => {
    setInitialLayout(layout);
    setRename("new");
  };
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: presentationKeys.projects(search, offset),
    queryFn: ({ signal }) => listProjects(search, offset, signal),
  });
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await cache.invalidateQueries({ queryKey: presentationKeys.all });
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="presentation-library workshop-page workshop-projects-page">
      <WorkshopAppChrome
        title="我的演示文稿"
        description="把想法整理成清晰的表达。"
        actions={
          !readOnly ? (
            <>
              <ImportButton onOpen={onOpen} />
              <button
                type="button"
                className="workshop-primary"
                disabled={busy}
                onClick={() => startNew()}
              >
                <Plus aria-hidden />
                新建演示文稿
              </button>
            </>
          ) : null
        }
      />
      <div className="presentation-library-content">
        <div className="presentation-library-intro">
          <h2>让想法，成为精彩的演示</h2>
          <p>从一个清晰的想法开始，构建你的下一次表达。</p>
        </div>

        <div className="presentation-library-tools">
          <h3>
            我的文稿 <span>{query.data?.total ?? 0}</span>
          </h3>
          <label className="presentation-search">
            <Search size={16} aria-hidden />
            <input
              placeholder="搜索文稿"
              aria-label="搜索文稿"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
        </div>
        {error ? (
          <p role="alert" className="presentation-error">
            {error}
          </p>
        ) : null}
        {query.isPending ? (
          <LoadingState label="正在加载文稿…" variant="region" />
        ) : query.isError ? (
          <p role="alert">
            加载失败{" "}
            <button className="btn" onClick={() => void query.refetch()}>
              重试
            </button>
          </p>
        ) : null}
        <div className="presentation-project-grid">
          {query.data?.items.map((project) => (
            <article className="presentation-project-card" key={project.id}>
              <PresentationPreviewCard
                title={project.title}
                firstSlide={project.first_slide}
                size={{
                  width: project.width ?? 1280,
                  height: project.height ?? 720,
                }}
                projectId={project.id}
                actionLabel="打开文稿"
                onUse={() => onOpen(project.id)}
                className="presentation-project-open"
              />
              <div className="presentation-project-footer">
                <div className="presentation-project-info">
                  <button
                    type="button"
                    onClick={() => onOpen(project.id)}
                    aria-label={`打开 ${project.title}`}
                    title={project.title}
                  >
                    {project.title}
                  </button>
                  <p>
                    {project.slide_count} 页 ·{" "}
                    {new Date(project.updated_at).toLocaleDateString("zh-CN")}
                  </p>
                </div>
                {!readOnly ? (
                  <PresentationMenu
                    className="presentation-project-actions"
                    label={`文稿操作 ${project.title}`}
                    disabled={busy}
                    actions={[
                      {
                        label: `重命名 ${project.title}`,
                        icon: <Pencil size={15} aria-hidden />,
                        onSelect: () => setRename(project),
                      },
                      {
                        label: `复制 ${project.title}`,
                        icon: <Copy size={15} aria-hidden />,
                        onSelect: () =>
                          void perform(async () => {
                            const p = await getProject(project.id);
                            const copy = await createProject({
                              title: p.title.slice(0, 110) + "（副本）",
                              document: p.document,
                            });
                            onOpen(copy.id);
                          }),
                      },
                      {
                        label: `删除 ${project.title}`,
                        icon: <Trash2 size={15} aria-hidden />,
                        danger: true,
                        onSelect: () => setRemove(project),
                      },
                    ]}
                  >
                    <MoreHorizontal size={16} aria-hidden />
                  </PresentationMenu>
                ) : null}
              </div>
            </article>
          ))}
          {!readOnly && query.isSuccess && !search && (
            <button
              type="button"
              className="presentation-create-card"
              disabled={busy}
              onClick={() => startNew()}
            >
              <span className="presentation-create-card-mark" aria-hidden>
                <Plus size={20} />
              </span>
              <span>新建演示</span>
            </button>
          )}
        </div>
        {query.isSuccess && query.data.total === 0 ? (
          <div className="presentation-library-empty">
            <Presentation size={44} />
            <h3>{search ? "没有找到匹配的文稿" : "从你的第一份演示开始"}</h3>
            <p>
              {search
                ? "试试其他关键词，或清空搜索查看全部文稿。"
                : readOnly
                  ? "当前账号还没有可浏览的演示文稿。"
                  : "选择一个基础版式，开始你的第一份演示。"}
            </p>
          </div>
        ) : null}
        {query.data && query.data.total > 24 ? (
          <nav className="presentation-pagination" aria-label="文稿分页">
            <button
              className="btn"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 24))}
            >
              上一页
            </button>
            <span>{offset / 24 + 1}</span>
            <button
              className="btn"
              disabled={offset + 24 >= query.data.total}
              onClick={() => setOffset(offset + 24)}
            >
              下一页
            </button>
          </nav>
        ) : null}
      </div>
      <TextInputDialog
        className="presentation-dialog presentation-dialog-small"
        open={rename !== null}
        title={rename === "new" ? "新建演示文稿" : "重命名文稿"}
        label="文稿名称"
        initialValue={rename && rename !== "new" ? rename.title : "未命名演示"}
        onCancel={() => setRename(null)}
        onConfirm={(title) => {
          const target = rename;
          setRename(null);
          void perform(async () => {
            if (target === "new") {
              const p = await createProject({
                title: title.slice(0, 120),
                document: newDeck(initialLayout),
              });
              onOpen(p.id);
            } else if (target) {
              const p = await getProject(target.id);
              await saveProject(
                p.id,
                { title: title.slice(0, 120), document: p.document },
                p.revision,
              );
            }
          });
        }}
      />
      <ConfirmDialog
        className="presentation-dialog presentation-dialog-small"
        open={!!remove}
        title="删除演示文稿"
        description={`确定删除“${remove?.title ?? ""}”？文稿将永久删除，公共文件库中的图片会保留。`}
        pending={busy}
        confirmLabel="删除"
        onCancel={() => setRemove(null)}
        onConfirm={() =>
          perform(async () => {
            if (remove) await deleteProject(remove.id, remove.revision);
            setRemove(null);
          })
        }
      />
    </div>
  );
}
