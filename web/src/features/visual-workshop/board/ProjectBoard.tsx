import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  FolderOpen,
  Plus,
  Search,
  MessageSquare,
  PanelsTopLeft,
  LayoutGrid,
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
import { nodeStatus, nodeTypeNames, type BoardController } from "./boardTypes";
import { InputReferences } from "./InputReferences";
import { OutputHistory } from "./OutputHistory";
import { BoardMenu } from "./BoardMenu";
import { MaterialTree, type TreeAction } from "./MaterialTree";
import { TextWorkbench } from "./TextWorkbench";
import { NodeMetadata } from "./NodeMetadata";
import { StatusBoard } from "./StatusBoard";
import { statusIcons, statusKeys, typeIcons } from "./boardPresentation";
import type { VisualNodeOutput } from "../api";
import "./project-board.css";
import "./workbench.css";
import "./status-board.css";

export function ProjectBoard({
  controller: c,
  onCanvas,
  previews,
  onPreview,
}: {
  controller: BoardController;
  onCanvas: () => void;
  previews: Record<string, VisualNodeOutput | undefined>;
  onPreview: (nodeId: string, version?: VisualNodeOutput) => void;
}) {
  const [tab, setTab] = useState<"workbench" | "status">("workbench");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<TreeAction>();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const [newKind, setNewKind] = useState("image");
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 600);
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth <= 600) setSidebarOpen(false);
      else if (window.innerWidth > 900) setSidebarOpen(true);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
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
  const selectedStatus = selected
    ? nodeStatus(
        selected,
        tasks.data ?? [],
        ready(selected.id),
        batches.data ?? [],
      )
    : "待准备";
  const SelectedStatusIcon = statusIcons[selectedStatus];
  const SelectedTypeIcon = typeIcons[selected?.kind ?? "image"];
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
            <MessageSquare size={15} /> 对话
          </button>
        </div>
      </header>
      <div className="board-layout">
        <aside
          id="board-project-materials"
          className={`board-materials ${sidebarOpen ? "" : "is-collapsed"}`}
          aria-label="项目素材"
        >
          <div className="board-output-heading">
            <h2>项目素材</h2>
            <BoardMenu
              label="项目素材管理"
              items={[
                {
                  label: "新建分类",
                  onSelect: () => setAction({ kind: "category" }),
                },
              ]}
            />
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
          <button
            className="board-upload"
            disabled={c.upload.isPending}
            onClick={() => uploadInput.current?.click()}
          >
            <Upload size={14} /> 上传素材
          </button>
          <input
            ref={uploadInput}
            hidden
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (files.length) c.upload.mutate(files);
            }}
          />
          <MaterialTree
            categories={categories}
            nodes={filtered}
            selectedId={selected?.id}
            onSelect={select}
            onAction={setAction}
          />
          <div className="board-material-footer">
            <button onClick={() => c.setAssetsOpen(true)}>
              <FolderOpen size={15} /> 导入 / 管理素材
            </button>
          </div>
        </aside>
        <main className="board-main">
          <nav className="board-tabs" aria-label="看板内容">
            <button
              aria-label="切换项目素材面板"
              aria-expanded={sidebarOpen}
              aria-controls="board-project-materials"
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
              <PanelsTopLeft size={15} /> 创作工作台
            </button>
            <button
              aria-pressed={tab === "status"}
              className={tab === "status" ? "active" : ""}
              onClick={() => setTab("status")}
            >
              <LayoutGrid size={15} /> 状态分组
            </button>
            <span>{c.nodes.length} 个节点</span>
          </nav>
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
            <StatusBoard
              controller={c}
              nodes={filtered}
              tasks={tasks.data ?? []}
              batches={batches.data ?? []}
              ready={ready}
              onSelect={(id) => {
                select(id);
                setTab("workbench");
              }}
            />
          ) : selected ? (
            <div className="board-workbench" key={selected.id}>
              <section className="board-editor">
                <div className="board-node-heading">
                  <div className="board-node-topline">
                    <span className="board-node-type">
                      <SelectedTypeIcon size={14} />
                      {nodeTypeNames[selected.kind]}节点
                    </span>
                    <span
                      className={`board-state-badge is-${statusKeys[selectedStatus]}`}
                    >
                      <SelectedStatusIcon size={12} />
                      {selectedStatus}
                    </span>
                    <BoardMenu
                      label="节点更多操作"
                      items={[
                        {
                          label: "删除节点",
                          danger: true,
                          onSelect: () => c.removeNode(selected.id),
                        },
                      ]}
                    />
                  </div>
                  <input
                    aria-label="节点名称"
                    value={selected.title}
                    maxLength={120}
                    onChange={(event) =>
                      c.patchNode(selected.id, { title: event.target.value })
                    }
                  />
                </div>
                <NodeMetadata
                  key={selected.id}
                  node={selected}
                  categories={categories}
                  onPatch={c.patchNode}
                />
                <InputReferences
                  key={selected.id}
                  controller={c}
                  nodeId={selected.id}
                />
                {selected.kind === "text" ? (
                  <TextWorkbench controller={c} node={selected} />
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
                    generationLayout="workbench"
                  />
                )}
              </section>
              <OutputHistory
                controller={c}
                nodeId={selected.id}
                preview={previews[selected.id]}
                onPreview={(version) => onPreview(selected.id, version)}
              />
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
