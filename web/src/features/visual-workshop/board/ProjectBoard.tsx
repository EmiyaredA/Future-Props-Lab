import { BoardNodeEditor } from "./BoardNodeEditor";
import { AmadeusButton } from "@platform/AmadeusButton";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { LoadingState } from "@shared/ui/LoadingState";
import { invalidateFileScope, type ManagedFile } from "@features/files";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "@platform/api/errors";
import { CommonDesignCards } from "./CommonDesignCards";
import { designKind } from "./designCategories";
import { DesignCardPicker } from "../creative/DesignCardPicker";
import {
  cardsKey,
  createCard,
  type Card,
  type CardKind,
} from "../creative/api";
import { resolveDesignImage } from "../creative/cardMedia";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  FolderOpen,
  Plus,
  Search,
  PanelsTopLeft,
  LayoutGrid,
  SlidersHorizontal,
  Upload,
  Pencil,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { CanvasAssetsDrawer } from "../canvas/CanvasAssetsDrawer";
import { isCanvasMediaKind } from "../canvas/canvasAssetDrag";
import { batchInsertionAnchor, placeNode } from "../canvas/canvasPlacement";
import { nextNodeId } from "../canvas/geometry";
import {
  getGenerationTasks,
  getGenerationBatches,
  getVisualCanvas,
  putVisualCanvas,
  type VisualMaterialCategory,
  type MaterialUploadDestination,
} from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import {
  nodeStatus,
  nodeTypeNames,
  type ProjectBoardProps,
} from "./boardTypes";
import { OutputHistory } from "./OutputHistory";
import { BoardMenu } from "./BoardMenu";
import { MaterialTree, type TreeAction } from "./MaterialTree";
import { MaterialUpload } from "./MaterialUpload";
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
import "./board-design-cards.css";
import "./workbench.css";
import "./status-board.css";

const ProjectAssetCardEditor = lazy(() =>
  import("../creative/AssetCards").then(({ AssetCards }) => ({
    default: AssetCards,
  })),
);

export function ProjectBoard({
  controller: c,
  onCanvas,
  onPrevis,
  onScript,
  onAcceptance,
  previews,
  onPreview,
  acceptanceEntry,
}: ProjectBoardProps) {
  const transfer = useTransferProgress();
  const [nodeTab, setNodeTab] = useState<"content" | "generate" | "acceptance">(
    "generate",
  );
  const [tab, setTab] = useState<"workbench" | "status">("workbench");
  const [search, setSearch] = useState("");
  const [cardPicker, setCardPicker] = useState<{
    nodeId?: string;
    kind?: CardKind;
  }>();
  const [viewCard, setViewCard] = useState<Card>();
  const [cardRequest, setCardRequest] = useState<{
    nodeId: string;
    card: Card;
  }>();
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
  const materialBatch = useRef<{
    files: ManagedFile[];
    nodes: VisualCanvasNode[];
  }>(undefined);
  const titleButton = useRef<HTMLButtonElement>(null);
  const savingTitle = useRef(false);
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
  const addCards = (cards: Card[], legacyNodeId?: string) =>
    c.replaceProjectCardIds(
      [
        ...new Set([
          ...c.projectCardIdsRef.current,
          ...cards.map(({ id }) => id),
        ]),
      ],
      legacyNodeId && cards[0]
        ? { nodeId: legacyNodeId, cardId: cards[0].id }
        : undefined,
    );
  const selectedDesignKind = designKind(
    categories.find(({ id }) => id === selected?.category_id),
  );
  const legacyKind =
    selected?.kind === "image" && selected.asset_id
      ? selectedDesignKind
      : undefined;
  async function createLegacyCard() {
    if (
      !legacyKind ||
      selected?.kind !== "image" ||
      !selected.asset_id ||
      pending
    )
      return;
    setPending(true);
    setNotice("");
    try {
      const card = await createCard(c.projectId, {
        title: selected.title,
        kind: legacyKind,
        adopted_asset_id: selected.asset_id,
      });
      c.client.setQueryData<Card[]>(cardsKey, (old) => [...(old ?? []), card]);
      await addCards([card], selected.id);
    } catch (error) {
      setNotice(apiErrorMessage(error));
    } finally {
      setPending(false);
    }
  }
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
  const finishTitle = async (restoreFocus: boolean) => {
    if (savingTitle.current) return;
    const title = c.title.trim();
    if (!title || title === c.projectQuery.data?.title) {
      c.setEditingTitle(false);
    } else {
      savingTitle.current = true;
      try {
        await c.renameMutation.mutateAsync();
      } catch {
        return;
      } finally {
        savingTitle.current = false;
      }
    }
    if (restoreFocus) requestAnimationFrame(() => titleButton.current?.focus());
  };
  const addExistingMaterials = async (
    files: ManagedFile[],
    destination: MaterialUploadDestination,
  ) => {
    void invalidateFileScope(c.client, c.projectId);
    const revision = await c.prepareCanvasForAgent();
    const current = c.nodesRef.current;
    if (materialBatch.current?.files !== files) {
      const anchor = c.getInsertionAnchor();
      const added: VisualCanvasNode[] = [];
      for (const [index, file] of files.entries()) {
        const kind = file.media_kind;
        if (!isCanvasMediaKind(kind))
          throw new Error("只支持图片、视频和音频素材。");
        added.push({
          ...destination,
          id: nextNodeId(kind),
          kind,
          title: file.display_name.slice(0, 120),
          asset_id: file.id,
          position: placeNode(
            [...current, ...added],
            kind,
            batchInsertionAnchor(anchor, index, files.length),
          ),
        });
      }
      materialBatch.current = { files, nodes: added };
    }
    const added = materialBatch.current.nodes;
    const missing = added.filter(
      (node) => !current.some((item) => item.id === node.id),
    );
    const queryKey = visualWorkshopQueryKeys.canvas(c.projectId);
    if (missing.length) {
      let updated;
      try {
        updated = await putVisualCanvas(
          c.projectId,
          [...current, ...missing],
          revision,
          c.edgesRef.current,
        );
      } catch (error) {
        const latest = await getVisualCanvas(c.projectId).catch(
          () => undefined,
        );
        if (latest) {
          c.applyServerCanvas(latest);
          c.client.setQueryData(queryKey, latest);
        }
        if (
          !latest ||
          !added.every((node) =>
            latest.nodes.some((item) => item.id === node.id),
          )
        )
          throw error;
        updated = latest;
      }
      c.applyServerCanvas(updated);
      c.client.setQueryData(queryKey, updated);
    }
    materialBatch.current = undefined;
    c.setSelectedId(added.at(-1)?.id);
    setNodeTab("content");
    setTab("workbench");
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
            {c.editingTitle ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void finishTitle(true);
                }}
              >
                <input
                  aria-label="项目名称"
                  autoFocus
                  maxLength={120}
                  value={c.title}
                  readOnly={c.renameMutation.isPending}
                  onChange={(event) => c.setTitle(event.target.value)}
                  onBlur={() => void finishTitle(false)}
                  onKeyDown={(event) => {
                    if (
                      event.key !== "Escape" ||
                      event.nativeEvent.isComposing ||
                      savingTitle.current
                    )
                      return;
                    event.preventDefault();
                    c.renameMutation.reset();
                    c.setEditingTitle(false);
                    requestAnimationFrame(() => titleButton.current?.focus());
                  }}
                />
                {c.renameMutation.isError && (
                  <small role="alert">
                    {c.renameMutation.error instanceof Error
                      ? c.renameMutation.error.message
                      : "项目名称保存失败"}
                  </small>
                )}
              </form>
            ) : (
              <button
                type="button"
                className="board-project-title"
                ref={titleButton}
                disabled={!c.projectQuery.data}
                onClick={() => {
                  c.renameMutation.reset();
                  c.setTitle(c.projectQuery.data?.title ?? "");
                  c.setEditingTitle(true);
                }}
              >
                <span>{c.projectQuery.data?.title ?? "创作项目"}</span>
                <Pencil size={13} aria-hidden />
              </button>
            )}
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
            {onScript && <button onClick={onScript}>剧本</button>}
            {onPrevis && <button onClick={onPrevis}>白模预演</button>}
          </div>
          <AmadeusButton />
          {onAcceptance && (
            <button onClick={() => onAcceptance()}>
              <SlidersHorizontal size={15} /> 项目验收
            </button>
          )}
          <ThemeToggle />
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
              placeholder="搜索设定、名称、标签…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="board-material-content">
            <CommonDesignCards
              projectId={c.projectId}
              ids={c.projectCardIds}
              search={search}
              canUse={selected?.kind === "video"}
              disabled={!c.canvasReady || Boolean(c.conflict) || pending}
              onAdd={(kind) => setCardPicker({ kind })}
              onCreate={(kind) => {
                setPending(true);
                const label = {
                  character: "人设",
                  scene: "场景",
                  prop: "道具",
                }[kind];
                void createCard(c.projectId, { kind, title: `新建${label}卡` })
                  .then(async (card) => {
                    c.client.setQueryData<Card[]>(cardsKey, (old) => [
                      ...(old ?? []),
                      card,
                    ]);
                    await addCards([card]);
                    setViewCard(card);
                  })
                  .catch((error: unknown) => setNotice(apiErrorMessage(error)))
                  .finally(() => setPending(false));
              }}
              sources={c.nodes}
              onSource={select}
              onUse={(card) => {
                if (selected?.kind !== "video") return;
                setTab("workbench");
                setCardRequest({ nodeId: selected.id, card });
              }}
              onCanvas={(card) => {
                setNotice("");
                void (async () => {
                  setPending(true);
                  try {
                    const id = await resolveDesignImage(
                      c.client,
                      c.projectId,
                      card,
                      c.nodesRef.current,
                    );
                    c.createMediaNodeFromAsset(
                      {
                        id,
                        media_kind: "image",
                        display_name: card.title,
                        design_card_id: card.id,
                        design_card_revision: card.revision,
                      },
                      c.getInsertionAnchor(),
                    );
                    await c.prepareCanvasForAgent();
                    onCanvas();
                  } catch (error) {
                    setNotice(apiErrorMessage(error));
                  } finally {
                    setPending(false);
                  }
                })();
              }}
              onView={setViewCard}
              onRemove={(card) => {
                setNotice("");
                void c
                  .replaceProjectCardIds(
                    c.projectCardIdsRef.current.filter((id) => id !== card.id),
                  )
                  .catch((error: unknown) => setNotice(apiErrorMessage(error)));
              }}
            />
            <h3 className="board-files-heading">项目文件</h3>
            <div className="board-create-row">
              <CustomSelect
                value={newKind}
                ariaLabel="新建节点类型"
                onChange={setNewKind}
                options={Object.entries(nodeTypeNames).map(
                  ([value, label]) => ({
                    value,
                    label,
                  }),
                )}
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
                        category_id: selectedDesignKind
                          ? null
                          : (selected?.category_id ?? null),
                        group: selectedDesignKind
                          ? null
                          : (selected?.group ?? null),
                      },
                );
              }}
            >
              <Upload size={14} /> 上传素材
            </button>
            {uploadDestination && (
              <MaterialUpload
                projectId={c.projectId}
                categories={categories.filter(
                  (category) => !designKind(category),
                )}
                destination={uploadDestination}
                disabled={c.upload.isPending || !c.canvasReady}
                onChange={setUploadDestination}
                onUpload={(files, destination) => {
                  c.uploadPosition.current = undefined;
                  c.upload.mutate({ files, destination });
                }}
                onAddFiles={addExistingMaterials}
              />
            )}
            <MaterialTree
              projectId={c.projectId}
              categories={categories}
              nodes={filtered.filter(
                (node) =>
                  node.kind !== "image" ||
                  !node.design_card_id ||
                  !c.projectCardIds.includes(node.design_card_id),
              )}
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
          </div>
          {cardPicker && (
            <DesignCardPicker
              title={cardPicker.nodeId ? "关联已有设定卡" : "从设定库添加"}
              kind={cardPicker.kind}
              exclude={cardPicker.nodeId ? [] : c.projectCardIds}
              excludedLabel={cardPicker.nodeId ? undefined : "已添加到项目"}
              confirmLabel={cardPicker.nodeId ? undefined : "添加到项目"}
              onClose={() => setCardPicker(undefined)}
              onChoose={(cards) => addCards(cards, cardPicker.nodeId)}
            />
          )}
          {viewCard && (
            <Suspense
              fallback={
                <LoadingState variant="inline" label="正在打开设定卡" />
              }
            >
              <ProjectAssetCardEditor
                key={viewCard.id}
                project={c.projectId}
                fixedKind={viewCard.kind}
                initialCardId={viewCard.id}
                onCreated={(card) => addCards([card])}
                onCloseCard={() => setViewCard(undefined)}
              />
            </Suspense>
          )}
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
                  c.applyCanvasMetadata(c.conflict!);
                  c.clearHistory();
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
                <BoardNodeEditor
                  key={`${selected.id}:${acceptanceEntry?.nodeId === selected.id ? acceptanceEntry.entry : 0}`}
                  controller={c}
                  node={selected}
                  categories={categories}
                  nodeTab={nodeTab}
                  onTabChange={setNodeTab}
                  showMetadata={metadataNodeId === selected.id}
                  onMetadataChange={(open) =>
                    setMetadataNodeId(open ? selected.id : undefined)
                  }
                  legacyKind={legacyKind}
                  pending={pending}
                  onLegacyPick={() =>
                    legacyKind &&
                    setCardPicker({ nodeId: selected.id, kind: legacyKind })
                  }
                  onLegacyCreate={() => void createLegacyCard()}
                  initialAcceptance={acceptanceEntry?.nodeId === selected.id}
                  card={
                    cardRequest?.nodeId === selected.id
                      ? cardRequest.card
                      : undefined
                  }
                  onCardHandled={() =>
                    setCardRequest((current) =>
                      current === cardRequest ? undefined : current,
                    )
                  }
                  acceptanceOutput={
                    previews[selected.id] ??
                    (acceptanceEntry?.nodeId === selected.id
                      ? acceptanceEntry.output
                      : selected.final_output_id
                        ? ({ id: selected.final_output_id } as VisualNodeOutput)
                        : undefined)
                  }
                  generating={selectedStatus === "生成中"}
                  onAcceptance={onAcceptance}
                />
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
