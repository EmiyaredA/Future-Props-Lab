import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Heart,
  Maximize2,
  Pencil,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { api, unwrap } from "@platform/api/client";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { ProjectLibraryCard } from "@shared/ui/project-library";
import {
  createProject,
  importWhale,
  deleteProject,
  listProjects,
  renameProject,
  type PetProject,
} from "./api";
import "./workshop.css";

type CharacterSource = {
  id: string;
  title: string;
  revision: number;
  thumbnail?: string | null;
};

export function ProjectsPage({
  onOpen,
  readOnly = false,
}: {
  onOpen: (id: string) => void;
  readOnly?: boolean;
}) {
  const [projects, setProjects] = useState<PetProject[]>([]);
  const [sources, setSources] = useState<CharacterSource[]>([]);
  const [query, setQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const [title, setTitle] = useState("");
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(
    null,
  );
  const [selected, setSelected] = useState<PetProject | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const whaleInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const [pets, characters] = await Promise.all([
      listProjects(),
      api.GET("/v1/live2d-workshop/projects").then(unwrap),
    ]);
    setProjects(pets.items);
    setSources(characters.items);
  };
  useEffect(() => {
    let mounted = true;
    Promise.all([
      listProjects(),
      api.GET("/v1/live2d-workshop/projects").then(unwrap),
    ])
      .then(([pets, characters]) => {
        if (!mounted) return;
        setProjects(pets.items);
        setSources(characters.items);
      })
      .catch((cause) => {
        if (mounted) setError(String(cause));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    void window.futurePropsDesktop?.petStatus?.().then((status) => {
      if (mounted) setActiveId(status.projectId);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const filtered = useMemo(
    () =>
      projects.filter((project) =>
        project.title
          .toLocaleLowerCase("zh-CN")
          .includes(query.trim().toLocaleLowerCase("zh-CN")),
      ),
    [projects, query],
  );
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "桌宠操作失败");
    } finally {
      setBusy(false);
    }
  };
  const launch = (id: string) =>
    run(async () => {
      if (!window.futurePropsDesktop?.openPet)
        throw new Error("真实桌宠仅在 macOS 桌面版中运行");
      await window.futurePropsDesktop.openPet(id);
      setActiveId(id);
    });
  const close = () =>
    run(async () => {
      await window.futurePropsDesktop?.closePet?.();
      setActiveId(null);
    });

  return (
    <section className="workshop-page workshop-projects-page dp-projects">
      <WorkshopAppChrome
        title="我的桌宠"
        description="从 Live2D 角色工程或本地分层角色资源包制作会动、会回应的桌面伙伴。"
        actions={
          !readOnly && (
            <>
              <input
                ref={whaleInput}
                type="file"
                accept=".zip,application/zip"
                hidden
                aria-label="桌宠角色资源包"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file)
                    void run(async () => {
                      const project = await importWhale(file);
                      await refresh();
                      onOpen(project.id);
                    });
                }}
              />
              <button
                className="workshop-secondary"
                disabled={busy}
                onClick={() => whaleInput.current?.click()}
              >
                导入角色资源包
              </button>
              <button
                className="workshop-primary"
                onClick={() => setDialog("create")}
              >
                <Plus size={16} />
                新建桌宠
              </button>
            </>
          )
        }
      />
      <div className="workshop-toolbar workshop-toolbar-simple">
        <label>
          <Search size={18} />
          <input
            aria-label="搜索桌宠项目"
            value={query}
            placeholder="搜索桌宠项目…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="dp-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="workshop-state">正在读取桌宠项目…</div>
      ) : filtered.length ? (
        <div className="workshop-project-grid" aria-live="polite">
          {filtered.map((project) => (
            <ProjectLibraryCard
              key={project.id}
              project={{
                id: project.id,
                title: project.title,
                updated_at: project.updatedAt,
              }}
              cover="live2d"
              coverTitle={
                project.sourceType === "coopanion-whale"
                  ? project.title
                  : "桌宠工程"
              }
              coverDescription={
                project.sourceType === "coopanion-whale"
                  ? "分层动态 · 表情 · 交互"
                  : "角色 · 皮肤 · 交互"
              }
              coverContent={
                project.thumbnailUrl ? (
                  <img
                    className="dp-whale-cover"
                    src={project.thumbnailUrl}
                    alt=""
                  />
                ) : undefined
              }
              metadata={
                <span>
                  {activeId === project.id
                    ? "桌面运行中"
                    : project.sourceType === "coopanion-whale"
                      ? "分层角色本地快照"
                      : `来源 r${project.sourceRevision}`}
                </span>
              }
              description={`来源：${
                project.sourceType === "coopanion-whale"
                  ? `本地角色资源包 · ${project.title}`
                  : project.sourceTitle
              }`}
              onOpen={() => onOpen(project.id)}
            >
              <div className="workshop-project-primary-actions">
                <button onClick={() => onOpen(project.id)}>
                  <Maximize2 size={15} />
                  编辑
                </button>
                {activeId === project.id ? (
                  <button disabled={busy} onClick={() => void close()}>
                    <Square size={14} />
                    收起桌宠
                  </button>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => void launch(project.id)}
                  >
                    <Play size={14} />
                    放到桌面
                  </button>
                )}
              </div>
              {!readOnly && (
                <div className="workshop-project-secondary-actions">
                  <button
                    aria-label={`重命名 ${project.title}`}
                    onClick={() => {
                      setSelected(project);
                      setTitle(project.title);
                      setDialog("rename");
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    aria-label={`删除 ${project.title}`}
                    onClick={() => {
                      setSelected(project);
                      setDialog("delete");
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </ProjectLibraryCard>
          ))}
        </div>
      ) : (
        <div className="workshop-state dp-empty">
          <Heart aria-hidden />
          <strong>还没有桌宠项目</strong>
          <p>先在 Live2D 工坊保存角色，再从这里创建桌宠。</p>
        </div>
      )}
      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dp-dialog-overlay" />
          <Dialog.Content className="dp-dialog">
            <Dialog.Title>
              {dialog === "delete"
                ? "删除桌宠项目"
                : dialog === "rename"
                  ? "重命名桌宠"
                  : "从 Live2D 角色创建桌宠"}
            </Dialog.Title>
            <Dialog.Description>
              {dialog === "delete"
                ? "将删除这只桌宠的配置与素材快照。来源角色工程不会受到影响。"
                : dialog === "rename"
                  ? "修改显示名称，不改变来源角色与已保存配置。"
                  : "选择已保存的角色项目。桌宠会保留当前版本的独立快照。"}
            </Dialog.Description>
            {dialog === "create" ? (
              <div className="dp-dialog-form">
                <span>来源角色</span>
                <div
                  className="dp-source-options"
                  role="group"
                  aria-label="来源角色"
                >
                  {sources.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selectedSource === item.id}
                      onClick={() => {
                        setSelectedSource(item.id);
                        setTitle(`${item.title} · 桌宠`);
                      }}
                    >
                      <strong>{item.title}</strong>
                      <small>版本 r{item.revision}</small>
                    </button>
                  ))}
                  {!sources.length && (
                    <p>暂无 Live2D 角色，请先在 Live2D 工坊制作或导入工程。</p>
                  )}
                </div>
                <label>
                  桌宠名称
                  <input
                    value={title}
                    maxLength={120}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
              </div>
            ) : dialog === "rename" ? (
              <div className="dp-dialog-form">
                <label>
                  桌宠名称
                  <input
                    value={title}
                    maxLength={120}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
              </div>
            ) : (
              <p>「{selected?.title}」</p>
            )}
            <div className="dp-dialog-actions">
              <button type="button" onClick={() => setDialog(null)}>
                取消
              </button>
              <button
                type="button"
                className="dp-confirm"
                disabled={
                  busy ||
                  (dialog === "create" && !selectedSource) ||
                  (dialog === "rename" && !title.trim())
                }
                onClick={() =>
                  void run(async () => {
                    if (dialog === "create") {
                      const source = sources.find(
                        (item) => item.id === selectedSource,
                      );
                      if (!source) return;
                      const project = await createProject(
                        source.id,
                        source.revision,
                        title,
                      );
                      setDialog(null);
                      onOpen(project.id);
                    } else if (dialog === "rename" && selected) {
                      await renameProject(
                        selected.id,
                        selected.revision,
                        title,
                      );
                      await refresh();
                      setDialog(null);
                    } else if (dialog === "delete" && selected) {
                      if (activeId === selected.id) {
                        await window.futurePropsDesktop?.closePet?.();
                        setActiveId(null);
                      }
                      await deleteProject(selected.id, selected.revision);
                      await refresh();
                      setDialog(null);
                    }
                  })
                }
              >
                {dialog === "delete"
                  ? "删除项目"
                  : dialog === "rename"
                    ? "保存名称"
                    : "创建桌宠"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
