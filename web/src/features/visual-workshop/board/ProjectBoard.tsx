import { AmadeusButton } from "@platform/AmadeusButton";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { LoadingState } from "@shared/ui/LoadingState";
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
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { CanvasNodeInspector } from "../canvas/CanvasNodeInspector";
import { CanvasAssetsDrawer } from "../canvas/CanvasAssetsDrawer";
import { ProjectAssistantPanel } from "../assistant/ProjectAssistantPanel";
import {
  getGenerationTasks,
  getGenerationBatches,
  putVisualCanvas,
  type VisualMaterialCategory,
  type MaterialUploadDestination,
} from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import { nodeStatus, nodeTypeNames, type BoardController } from "./boardTypes";
import { InputReferences } from "./InputReferences";
import { OutputHistory } from "./OutputHistory";
import { BoardMenu } from "./BoardMenu";
import { MaterialTree, type TreeAction } from "./MaterialTree";
import { MaterialUpload } from "./MaterialUpload";
import { TextWorkbench } from "./TextWorkbench";
import { NodeMetadata } from "./NodeMetadata";
import {
  NodeManagementMenu,
  type NodeManagementAction,
} from "./NodeManagementMenu";
import { StatusBoard } from "./StatusBoard";
import { downloadNodeOutput } from "./downloadNodeOutput";
import { statusIcons, statusKeys, typeIcons } from "./boardPresentation";
import { GenerationSpinner } from "../generation/GenerationActivity";
import type { VisualCanvasNode, VisualNodeOutput } from "../api";
import "./project-board.css";
import "./workbench.css";
import "./status-board.css";

export function ProjectBoard({
  controller: c,
  onCanvas,
  onAcceptance,
  previews,
  onPreview,
  acceptanceEntry,
}: {
  acceptanceEntry?: {
    nodeId: string;
    output?: VisualNodeOutput;
    entry: number;
  };
  controller: BoardController;
  onCanvas: () => void;
  onAcceptance?: (output?: VisualNodeOutput) => void;
  previews: Record<string, VisualNodeOutput | undefined>;
  onPreview: (nodeId: string, version?: VisualNodeOutput) => void;
}) {
  const transfer = useTransferProgress();
  const [nodeTab, setNodeTab] = useState<"content" | "generate" | "acceptance">(
    "generate",
  );
  const [tab, setTab] = useState<"workbench" | "status">("workbench");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<TreeAction>();
  const [nodeAction, setNodeAction] = useState<{
    kind: "rename" | "delete";
    nodeId: string;
  }>();
  const [metadataNodeId, setMetadataNodeId] = useState<string>();
  const [downloading, setDownloading] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploadDestination, setUploadDestination] =
    useState<MaterialUploadDestination>();
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
  const manageNode = (kind: NodeManagementAction, node: VisualCanvasNode) => {
    if (kind === "download") {
      if (downloading) return;
      setDownloading(true);
      setNotice("");
      void transfer
        .run((onProgress) => downloadNodeOutput(node, { onProgress }))
        .catch((error: unknown) =>
          setNotice(error instanceof Error ? error.message : "下载失败"),
        )
        .finally(() => setDownloading(false));
    } else if (kind === "approve") {
      c.patchNode(node.id, { approved: !node.approved }, true);
    } else if (kind === "organize") {
      select(node.id);
      setTab("workbench");
      setMetadataNodeId(node.id);
    } else {
      setNodeAction({ kind, nodeId: node.id });
    }
  };
  const managedNode = c.nodes.find((node) => node.id === nodeAction?.nodeId);
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
      <TransferFeedback progress={transfer.progress} />
      <header className="board-header">
        <div className="board-identity">
          <button aria-label="返回项目列表" onClick={c.onBack}>
            <ArrowLeft size={18} />
          </button>
          <ResponsiveImage
            src="/brand/visual-workshop-mark-cutout.png"
            alt=""
          />
          <div>
            <strong>{c.projectQuery.data?.title ?? "创作项目"}</strong>
            <small>
              视觉创作工坊 ·{" "}
              {c.saveState === "saved" ? (
                "已保存"
              ) : c.saveState === "saving" ? (
                <LoadingState variant="inline" label="保存中" />
              ) : (
                "保存需要处理"
              )}
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
          <AmadeusButton />
          {onAcceptance && (
            <button onClick={() => onAcceptance()}>
              <SlidersHorizontal size={15} /> 项目验收
            </button>
          )}
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
                c.createNode(newKind as keyof typeof nodeTypeNames)
              }
            >
              <Plus size={15} /> 新建
            </button>
          </div>
          <button
            className="board-upload"
            disabled={c.upload.isPending || !c.canvasReady}
            aria-expanded={!!uploadDestination}
            onClick={() => {
              setUploadDestination(
                uploadDestination
                  ? undefined
                  : {
                      category_id: selected?.category_id ?? null,
                      group: selected?.group ?? null,
                    },
              );
            }}
          >
            <Upload size={14} /> 上传素材
          </button>
          {uploadDestination && (
            <MaterialUpload
              categories={categories}
              destination={uploadDestination}
              disabled={c.upload.isPending || !c.canvasReady}
              onChange={setUploadDestination}
              onUpload={(files, destination) => {
                c.uploadPosition.current = undefined;
                c.upload.mutate({ files, destination });
              }}
            />
          )}
          <MaterialTree
            projectId={c.projectId}
            categories={categories}
            nodes={filtered}
            runningNodeIds={
              new Set(
                c.nodes
                  .filter(
                    (node) =>
                      nodeStatus(
                        node,
                        tasks.data ?? [],
                        ready(node.id),
                        batches.data ?? [],
                      ) === "生成中",
                  )
                  .map((node) => node.id),
              )
            }
            selectedId={selected?.id}
            onSelect={select}
            onAction={setAction}
            onNodeAction={manageNode}
            downloading={downloading}
            onUpload={(categoryId) =>
              setUploadDestination({ category_id: categoryId, group: null })
            }
            uploadDisabled={c.upload.isPending || !c.canvasReady}
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
              {c.canvasQuery.isError ? (
                "项目加载失败"
              ) : (
                <LoadingState label="正在加载项目…" />
              )}
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
            <div
              className={`board-workbench ${selected.kind === "video" && nodeTab === "acceptance" ? "is-acceptance" : ""}`}
              key={selected.id}
            >
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
                      {selectedStatus === "生成中" ? (
                        <GenerationSpinner />
                      ) : (
                        <SelectedStatusIcon size={12} />
                      )}
                      {selectedStatus}
                    </span>
                    <NodeManagementMenu
                      node={selected}
                      onAction={manageNode}
                      downloading={downloading}
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
                <div
                  className="board-generation-context"
                  hidden={selected.kind === "video" && nodeTab === "acceptance"}
                >
                  <NodeMetadata
                    node={selected}
                    categories={categories}
                    onPatch={c.patchNode}
                    open={metadataNodeId === selected.id}
                    onOpenChange={(open) =>
                      setMetadataNodeId(open ? selected.id : undefined)
                    }
                  />
                  <InputReferences controller={c} nodeId={selected.id} />
                </div>
                {selected.kind === "text" ? (
                  <TextWorkbench controller={c} node={selected} />
                ) : (
                  <CanvasNodeInspector
                    key={`${selected.id}:${acceptanceEntry?.nodeId === selected.id ? acceptanceEntry.entry : 0}`}
                    initialTab={
                      acceptanceEntry?.nodeId === selected.id
                        ? "acceptance"
                        : undefined
                    }
                    acceptanceOutput={
                      previews[selected.id] ??
                      (acceptanceEntry?.nodeId === selected.id
                        ? acceptanceEntry.output
                        : selected.final_output_id
                          ? ({
                              id: selected.final_output_id,
                            } as VisualNodeOutput)
                          : undefined)
                    }
                    onTabChange={setNodeTab}
                    onAcceptanceTemplate={() => onAcceptance?.()}
                    generating={selectedStatus === "生成中"}
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
                acceptanceMode={
                  selected.kind === "video" && nodeTab === "acceptance"
                }
                onAcceptance={onAcceptance}
                controller={c}
                nodeId={selected.id}
                tasks={tasks.data ?? []}
                batches={batches.data ?? []}
                preview={
                  previews[selected.id] ??
                  (acceptanceEntry?.nodeId === selected.id
                    ? acceptanceEntry.output
                    : undefined)
                }
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
        open={nodeAction?.kind === "rename" && !!managedNode}
        title="重命名节点"
        label="节点名称"
        initialValue={managedNode?.title}
        maxLength={120}
        onCancel={() => setNodeAction(undefined)}
        onConfirm={(title) => {
          if (managedNode) c.patchNode(managedNode.id, { title }, true);
          setNodeAction(undefined);
        }}
      />
      <ConfirmDialog
        open={nodeAction?.kind === "delete" && !!managedNode}
        title="删除节点"
        description={`确认删除「${managedNode?.title ?? ""}」？这会移除该节点及其输入连线，项目素材中的原文件仍会保留。若它被下游节点引用，请先解除引用。`}
        confirmLabel="删除节点"
        onCancel={() => setNodeAction(undefined)}
        onConfirm={() => {
          if (managedNode) c.removeNode(managedNode.id);
          setNodeAction(undefined);
        }}
      />
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
