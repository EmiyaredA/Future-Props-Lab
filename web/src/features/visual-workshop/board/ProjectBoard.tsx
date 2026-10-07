import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  FolderOpen,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { CanvasNodeInspector } from "../canvas/CanvasNodeInspector";
import { CanvasAssetsDrawer } from "../canvas/CanvasAssetsDrawer";
import { ProjectAssistantPanel } from "../assistant/ProjectAssistantPanel";
import {
  getGenerationTasks,
  getGenerationBatches,
  putVisualCanvas,
  type VisualMaterialCategory,
} from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import {
  boardStatuses,
  nodeStatus,
  nodeTypeNames,
  type BoardController,
} from "./boardTypes";
import { InputReferences } from "./InputReferences";
import { OutputHistory } from "./OutputHistory";
import { OutputPreview } from "./OutputPreview";
import "./project-board.css";

type TreeAction = {
  kind: "category" | "rename" | "group";
  categoryId?: string;
  initialValue?: string;
};

export function ProjectBoard({
  controller: c,
  onCanvas,
}: {
  controller: BoardController;
  onCanvas: () => void;
}) {
  const [tab, setTab] = useState<"workbench" | "status">("workbench");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<TreeAction>();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [newKind, setNewKind] = useState("image");
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 600);
  const seenTaskStates = useRef("");
  const tasks = useQuery({
    queryKey: visualWorkshopQueryKeys.generationTaskList(
      c.projectId,
      "board",
      "all",
    ),
    queryFn: async () => {
      const first = await getGenerationTasks({
        projectId: c.projectId,
        pageSize: 100,
        currentNodes: true,
      });
      const items = [...first.items];
      for (let page = 2; items.length < first.total; page++) {
        const next = await getGenerationTasks({
          projectId: c.projectId,
          pageSize: 100,
          currentNodes: true,
          page,
        });
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return items;
    },
    refetchInterval: (query) =>
      query.state.data?.some((task) =>
        ["queued", "submitting", "pending", "processing"].includes(task.status),
      )
        ? 1500
        : false,
  });
  const batches = useQuery({
    queryKey: visualWorkshopQueryKeys.generationBatchList(c.projectId),
    queryFn: async () => {
      const first = await getGenerationBatches(c.projectId, 1, true);
      const items = [...first.items];
      for (let page = 2; items.length < first.total; page++) {
        const next = await getGenerationBatches(c.projectId, page, true);
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return items;
    },
    refetchInterval: (query) =>
      query.state.data?.some((batch) =>
        ["queued", "processing"].includes(batch.status),
      )
        ? 1500
        : false,
  });
  const taskStates =
    (tasks.data ?? [])
      .map((task) => `${task.id}:${task.status}:${task.result_asset_id ?? ""}`)
      .join(",") +
    (batches.data ?? [])
      .map(
        (batch) => `${batch.id}:${batch.status}:${batch.result_asset_id ?? ""}`,
      )
      .join(",");
  useEffect(() => {
    if (seenTaskStates.current === taskStates) return;
    seenTaskStates.current = taskStates;
    void c.client.invalidateQueries({
      queryKey: visualWorkshopQueryKeys.canvas(c.projectId),
    });
    void c.client.invalidateQueries({
      queryKey: visualWorkshopQueryKeys.nodeOutputsProject(c.projectId),
    });
  }, [taskStates, c.client, c.projectId]);
  const categories = c.canvasQuery.data?.categories ?? [];
  const selected =
    c.nodes.find((node) => node.id === c.selectedId) ?? c.nodes[0];
  const filtered = c.nodes.filter((node) =>
    `${node.title} ${(node.tags ?? []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const ready = (nodeId: string) =>
    c.edges
      .filter((edge) => edge.target_node_id === nodeId)
      .every(
        (edge) =>
          edge.binding === "fixed" ||
          c.nodes.find((node) => node.id === edge.source_node_id)
            ?.final_output_id,
      );
  const select = (id: string) => {
    c.setSelectedId(id);
    c.setSelectedNodeIds([id]);
    if (window.innerWidth <= 600) setSidebarOpen(false);
  };
  const saveCategories = async (next: VisualMaterialCategory[]) => {
    setPending(true);
    setNotice("");
    try {
      const revision = await c.prepareCanvasForAgent();
      const updated = await putVisualCanvas(
        c.projectId,
        c.nodesRef.current,
        revision,
        c.edgesRef.current,
        next,
      );
      c.client.setQueryData(
        visualWorkshopQueryKeys.canvas(c.projectId),
        updated,
      );
      setAction(undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  };
  const treeEntry = (node: (typeof c.nodes)[number]) => (
    <button
      key={node.id}
      className={`board-material ${selected?.id === node.id ? "is-selected" : ""}`}
      aria-pressed={selected?.id === node.id}
      onClick={() => select(node.id)}
    >
      <div className="board-material-thumb">
        <OutputPreview
          kind={node.kind}
          assetId={node.kind !== "text" ? node.asset_id : undefined}
          text={node.kind === "text" ? node.text : undefined}
          compact
        />
      </div>
      <span>
        <strong>{node.title}</strong>
        <small>
          {nodeTypeNames[node.kind]} ·{" "}
          {node.final_version ? `最终 v${node.final_version}` : "暂无输出"}
        </small>
      </span>
    </button>
  );
  return (
    <div className="visual-project-board">
      <header className="board-header">
        <div className="board-identity">
          <button aria-label="返回项目列表" onClick={c.onBack}>
            <ArrowLeft size={18} />
          </button>
          <img src="/brand/visual-workshop-mark-cutout.png" alt="" />
          <div>
            <strong>{c.projectQuery.data?.title ?? "创作项目"}</strong>
            <small>
              视觉创作工坊 ·{" "}
              {c.saveState === "saved"
                ? "已保存"
                : c.saveState === "saving"
                  ? "保存中"
                  : "保存需要处理"}
            </small>
          </div>
        </div>
        <div className="board-header-actions">
          <div
            className="visual-project-view-toggle"
            role="group"
            aria-label="项目视图"
          >
            <button aria-pressed="false" onClick={onCanvas}>
              画布
            </button>
            <button className="active" aria-pressed="true">
              看板
            </button>
          </div>
          <ThemeToggle />
          <button
            aria-expanded={c.assistantOpen}
            onClick={() => c.setAssistantOpen(!c.assistantOpen)}
          >
            对话
          </button>
        </div>
      </header>
      <div className="board-layout">
        <aside
          className={`board-materials ${sidebarOpen ? "" : "is-collapsed"}`}
          aria-label="项目素材"
        >
          <div className="board-output-heading">
            <h2>项目素材</h2>
            <button
              aria-label="新建分类"
              onClick={() => setAction({ kind: "category" })}
            >
              <Plus size={18} />
            </button>
          </div>
          <label className="board-search">
            <Search size={16} />
            <input
              aria-label="搜索项目素材"
              placeholder="搜索名称、标签…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="board-create-row">
            <CustomSelect
              value={newKind}
              ariaLabel="新建节点类型"
              onChange={setNewKind}
              options={Object.entries(nodeTypeNames).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <button
              className="board-primary"
              onClick={() =>
                c.createNode(newKind as keyof typeof nodeTypeNames, {
                  x: 100 + c.nodes.length * 20,
                  y: 100,
                })
              }
            >
              <Plus size={15} /> 新建
            </button>
          </div>
          <div className="board-material-tree">
            {categories.map((category) => {
              const nodes = filtered.filter(
                (node) => node.category_id === category.id,
              );
              const groups = [
                ...new Set([
                  ...(category.groups ?? []),
                  ...nodes
                    .map((node) => node.group)
                    .filter((group): group is string => !!group),
                ]),
              ];
              return (
                <details open key={category.id} className="board-category">
                  <summary>
                    {category.name}
                    <small>{nodes.length}</small>
                  </summary>
                  <div className="board-tree-tools">
                    <button
                      onClick={() =>
                        setAction({ kind: "group", categoryId: category.id })
                      }
                    >
                      ＋ 分组
                    </button>
                    <button
                      aria-label={`重命名分类 ${category.name}`}
                      onClick={() =>
                        setAction({
                          kind: "rename",
                          categoryId: category.id,
                          initialValue: category.name,
                        })
                      }
                    >
                      编辑分类
                    </button>
                  </div>
                  {groups.map((group) => (
                    <details open key={group} className="board-group">
                      <summary>{group}</summary>
                      {nodes
                        .filter((node) => node.group === group)
                        .map(treeEntry)}
                    </details>
                  ))}
                  <details open className="board-group">
                    <summary>未分组</summary>
                    {nodes.filter((node) => !node.group).map(treeEntry)}
                    {!nodes.length && <p className="board-muted">暂无素材</p>}
                  </details>
                </details>
              );
            })}
            <details open className="board-category">
              <summary>
                未分类
                <small>
                  {filtered.filter((node) => !node.category_id).length}
                </small>
              </summary>
              {filtered.filter((node) => !node.category_id).map(treeEntry)}
            </details>
          </div>
          <div className="board-material-footer">
            <label className="board-upload">
              <Upload size={15} /> 上传素材
              <input
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  if (files.length) c.upload.mutate(files);
                }}
              />
            </label>
            <button onClick={() => c.setAssetsOpen(true)}>
              <FolderOpen size={15} /> 导入 / 管理素材
            </button>
          </div>
        </aside>
        <main className="board-main">
          <nav className="board-tabs" aria-label="看板内容">
            <button
              aria-label="切换项目素材面板"
              className="board-sidebar-toggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <SlidersHorizontal size={16} />
            </button>
            <button
              aria-pressed={tab === "workbench"}
              className={tab === "workbench" ? "active" : ""}
              onClick={() => setTab("workbench")}
            >
              创作工作台
            </button>
            <button
              aria-pressed={tab === "status"}
              className={tab === "status" ? "active" : ""}
              onClick={() => setTab("status")}
            >
              状态分组
            </button>
            <span>{c.nodes.length} 个节点</span>
          </nav>
          {c.saveMessage && (
            <p className="board-notice" role="alert">
              {c.saveMessage}
            </p>
          )}
          {notice && (
            <p className="board-notice" role="alert">
              {notice}
            </p>
          )}
          {c.uploadNotice && (
            <p className="board-notice" role="status">
              {c.uploadNotice.message}
            </p>
          )}
          {c.conflict && (
            <div className="board-notice" role="alert">
              项目发生并发更新，本地草稿已保留。
              <button
                onClick={() => {
                  c.conflictRef.current = false;
                  c.revisionRef.current = c.conflict!.revision;
                  if (c.autoSave.current) clearTimeout(c.autoSave.current);
                  c.autoSave.current = undefined;
                  c.setNodes(c.conflict!.nodes);
                  c.nodesRef.current = c.conflict!.nodes;
                  c.setEdges(c.conflict!.edges);
                  c.edgesRef.current = c.conflict!.edges;
                  c.setConflict(undefined);
                  c.setSaveState("saved");
                }}
              >
                加载最新项目
              </button>
            </div>
          )}
          {c.saveMessage && (
            <p className="board-notice" role="alert">
              {c.saveMessage}
            </p>
          )}
          {!c.canvasReady ? (
            <p className="board-empty">
              {c.canvasQuery.isError ? "项目加载失败" : "正在加载项目…"}
            </p>
          ) : tab === "status" ? (
            <div className="board-status-grid">
              {boardStatuses.map((status) => (
                <section key={status} className="board-status-column">
                  <h2>
                    {status}
                    <small>
                      {
                        filtered.filter(
                          (node) =>
                            nodeStatus(
                              node,
                              tasks.data ?? [],
                              ready(node.id),
                              batches.data ?? [],
                            ) === status,
                        ).length
                      }
                    </small>
                  </h2>
                  {filtered
                    .filter(
                      (node) =>
                        nodeStatus(
                          node,
                          tasks.data ?? [],
                          ready(node.id),
                          batches.data ?? [],
                        ) === status,
                    )
                    .map((node) => {
                      const task =
                        node.kind !== "text"
                          ? (tasks.data?.find(
                              (task) =>
                                task.canvas_node_id === node.id &&
                                [
                                  "queued",
                                  "submitting",
                                  "pending",
                                  "processing",
                                ].includes(task.status),
                            ) ??
                            tasks.data?.find(
                              (task) => task.id === node.generation_task_id,
                            ))
                          : undefined;
                      const batch =
                        node.kind === "image"
                          ? (batches.data?.find(
                              (batch) =>
                                batch.generation_node_id === node.id &&
                                ["queued", "processing"].includes(batch.status),
                            ) ??
                            batches.data?.find(
                              (batch) => batch.id === node.generation_batch_id,
                            ))
                          : undefined;
                      const progress =
                        batch?.grid_output === "composite" &&
                        batch.generation_node_id === node.id
                          ? Math.round(
                              (100 * batch.completed_count) / batch.grid_size,
                            )
                          : (task?.progress ?? 0);
                      return (
                        <button
                          className="board-task-card"
                          key={node.id}
                          onClick={() => {
                            select(node.id);
                            setTab("workbench");
                          }}
                        >
                          <div className="board-card-preview">
                            <OutputPreview
                              kind={node.kind}
                              assetId={
                                node.kind !== "text" ? node.asset_id : undefined
                              }
                              text={
                                node.kind === "text" ? node.text : undefined
                              }
                              compact
                            />
                          </div>
                          <strong>{node.title}</strong>
                          <div className="board-card-tags">
                            <span>{nodeTypeNames[node.kind]}</span>
                            <span>
                              {categories.find(
                                (category) => category.id === node.category_id,
                              )?.name ?? "未分类"}
                            </span>
                            {(node.tags ?? []).map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                          <small>
                            {node.final_version
                              ? `最终输出 v${node.final_version}`
                              : "暂无输出"}
                          </small>
                          {status === "生成中" && (
                            <div className="board-progress">
                              <progress max={100} value={progress} /> {progress}
                              %
                            </div>
                          )}
                          {(task?.error_message || batch?.error_message) && (
                            <p className="board-card-error">
                              {task?.error_message ?? batch?.error_message} ·
                              点击调整并重试
                            </p>
                          )}
                          <p className="board-muted">
                            {c.edges
                              .filter((edge) => edge.target_node_id === node.id)
                              .map(
                                (edge) =>
                                  c.nodes.find(
                                    (source) =>
                                      source.id === edge.source_node_id,
                                  )?.title,
                              )
                              .join(" ＋ ") || "无上游引用"}
                          </p>
                        </button>
                      );
                    })}
                </section>
              ))}
            </div>
          ) : selected ? (
            <div className="board-workbench" key={selected.id}>
              <section className="board-editor">
                <button onClick={() => c.removeNode(selected.id)}>
                  删除节点
                </button>
                <div className="board-node-heading">
                  <span>
                    {nodeTypeNames[selected.kind]}节点 ·{" "}
                    {selected.id.slice(0, 12)}
                  </span>
                  <input
                    aria-label="节点名称"
                    value={selected.title}
                    maxLength={120}
                    onChange={(event) =>
                      c.patchNode(selected.id, { title: event.target.value })
                    }
                  />
                </div>
                <div className="board-classification">
                  <CustomSelect
                    ariaLabel="节点主分类"
                    value={selected.category_id ?? ""}
                    onChange={(value) =>
                      c.patchNode(
                        selected.id,
                        { category_id: value || null, group: null },
                        true,
                      )
                    }
                    options={[
                      { value: "", label: "未分类" },
                      ...categories.map((category) => ({
                        value: category.id,
                        label: category.name,
                      })),
                    ]}
                  />
                  <CustomSelect
                    ariaLabel="节点分组"
                    value={selected.group ?? ""}
                    onChange={(value) =>
                      c.patchNode(selected.id, { group: value || null }, true)
                    }
                    options={[
                      { value: "", label: "未分组" },
                      ...(
                        categories.find(
                          (category) => category.id === selected.category_id,
                        )?.groups ?? []
                      ).map((group) => ({ value: group, label: group })),
                    ]}
                  />
                </div>
                <label className="board-tags-label">
                  附加标签
                  <input
                    aria-label="附加标签"
                    placeholder="用逗号分隔，例如主角、清晨"
                    key={selected.id}
                    defaultValue={(selected.tags ?? []).join(", ")}
                    onBlur={(event) =>
                      c.patchNode(selected.id, {
                        tags: event.target.value
                          .split(/[,，]/)
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <InputReferences
                  key={selected.id}
                  controller={c}
                  nodeId={selected.id}
                />
                {selected.kind === "text" ? (
                  <label className="board-text-editor">
                    文本内容
                    <textarea
                      aria-label="文本内容"
                      value={selected.text}
                      onChange={(event) =>
                        c.patchNode(selected.id, { text: event.target.value })
                      }
                      maxLength={20000}
                      placeholder="编写脚本、角色描述或场景说明…"
                    />
                  </label>
                ) : (
                  <CanvasNodeInspector
                    key={selected.id}
                    projectId={c.projectId}
                    node={selected}
                    onClose={() => undefined}
                    onPatch={(patch, immediate) =>
                      c.patchNode(selected.id, patch, immediate)
                    }
                    onPrepareCanvas={c.prepareCanvasForAgent}
                    onTaskLinked={(taskId) =>
                      c.linkGenerationTask(selected.id, taskId)
                    }
                    onBatchCreated={async () => {
                      await c.canvasQuery.refetch();
                    }}
                    embedded
                  />
                )}
              </section>
              <OutputHistory controller={c} nodeId={selected.id} />
            </div>
          ) : (
            <div className="board-empty">
              <h2>开始你的创作</h2>
              <p>上传素材或新建一个节点，在这里整理输入和输出版本。</p>
            </div>
          )}
        </main>
      </div>
      {c.assetsOpen && (
        <CanvasAssetsDrawer
          projectId={c.projectId}
          assetTab={c.assetTab}
          assetView={c.assetView}
          onAssetTabChange={c.setAssetTab}
          onAssetViewChange={c.setAssetView}
          onClose={() => c.setAssetsOpen(false)}
        />
      )}
      {c.assistantOpen && (
        <ProjectAssistantPanel
          projectId={c.projectId}
          onClose={() => c.setAssistantOpen(false)}
          prepareCanvas={c.prepareCanvasForAgent}
          open
        />
      )}
      <TextInputDialog
        open={!!action}
        title={
          action?.kind === "group"
            ? "新建分组"
            : action?.kind === "rename"
              ? "编辑分类"
              : "新建分类"
        }
        label="名称"
        initialValue={action?.initialValue}
        maxLength={120}
        pending={pending}
        error={notice}
        onCancel={() => setAction(undefined)}
        onConfirm={(name) => {
          const next =
            action?.kind === "category"
              ? [...categories, { id: crypto.randomUUID(), name, groups: [] }]
              : categories.map((category) =>
                  category.id !== action?.categoryId
                    ? category
                    : action.kind === "rename"
                      ? { ...category, name }
                      : {
                          ...category,
                          groups: [
                            ...new Set([...(category.groups ?? []), name]),
                          ],
                        },
                );
          void saveCategories(next);
        }}
      />
    </div>
  );
}
