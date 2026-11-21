import { VisualProjectHeader } from "../canvas/VisualProjectHeader";
import { WorkbenchViewToggle } from "../WorkbenchViewToggle";
import { useWorkspaceSidebarState } from "../useWorkspaceSidebarState";
import { NodeApproval } from "../NodeApproval";
import { BoardNodeEditor } from "./BoardNodeEditor";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { LoadingState } from "@shared/ui/LoadingState";
import { invalidateFileScope, type ManagedFile } from "@features/files";
import { lazy, Suspense, useRef, useState } from "react";
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
import { useBoardGenerationTasks } from "./useBoardGenerationTasks";
import {
  FolderOpen,
  Plus,
  ChevronDown,
  PanelsTopLeft,
  LayoutGrid,
  Upload,
} from "lucide-react";
import { MaterialViews, type MaterialView } from "./MaterialViews";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CanvasAssetsDrawer } from "../canvas/CanvasAssetsDrawer";
import { isCanvasMediaKind } from "../canvas/canvasAssetDrag";
import { batchInsertionAnchor, placeNode } from "../canvas/canvasPlacement";
import { nextNodeId } from "../canvas/geometry";
import {
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
import type { VisualCanvasNode } from "../api";
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
  onStoryboard,
  previews,
  onPreview,
  embedded = false,
  view = "board",
  onView,
  canvasContent,
  section,
  onSection,
  storyboard,
}: ProjectBoardProps) {
  const transfer = useTransferProgress();
  const [tab, setTab] = useState<"workbench" | "status">("workbench");
  const [localMaterialView, setMaterialView] = useState<MaterialView>("files");
  const materialView =
    section && section !== "storyboard" ? section : localMaterialView;
  const [materialSearches, setMaterialSearches] = useState<
    Partial<Record<MaterialView, string>>
  >({});
  const activeSection = section ?? materialView;
  const search =
    activeSection === "storyboard"
      ? (storyboard?.search ?? "")
      : (materialSearches[activeSection] ?? "");
  const chooseSection = (next: typeof activeSection) => {
    if (onSection) onSection(next);
    else if (next === "storyboard") onStoryboard?.();
    else setMaterialView(next);
  };
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
  const [downloading, setDownloading] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploadDestination, setUploadDestination] =
    useState<MaterialUploadDestination>();
  const materialBatch = useRef<{
    files: ManagedFile[];
    nodes: VisualCanvasNode[];
  }>(undefined);
  const savingTitle = useRef(false);
  const [newKind, setNewKind] = useState("image");
  const {
    open: sidebarOpen,
    setOpen: setSidebarOpen,
    pinned,
    setPinned,
    desktop,
  } = useWorkspaceSidebarState();
  const { tasks, batches } = useBoardGenerationTasks(c.projectId, c.client);
  const categories = c.canvasQuery.data?.categories ?? [];
  const selected =
    c.nodes.find((node) => node.id === c.selectedId) ?? c.nodes[0];
  const addCards = (cards: Card[], legacyNodeId?: string) =>
    c.replaceProjectCardIds(
      [
        ...new Set([
          ...c.readCanvas().projectCardIds,
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
  const fileNodes = c.nodes.filter(
    (node) =>
      node.kind !== "image" ||
      !node.design_card_id ||
      !c.projectCardIds?.includes(node.design_card_id),
  );
  const filtered = c.nodes.filter((node) =>
    `${node.title} ${(node.tags ?? []).join(" ")}`
      .toLowerCase()
      .includes((materialSearches.files ?? "").toLowerCase()),
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
    if (view === "canvas") c.revealNode?.(id);
    if (!desktop) setSidebarOpen(false);
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
    } else {
      setNodeAction({ kind, nodeId: node.id });
    }
  };
  const managedNode = c.nodes.find((node) => node.id === nodeAction?.nodeId);
  const finishTitle = async () => {
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
  };
  const addExistingMaterials = async (
    files: ManagedFile[],
    destination: MaterialUploadDestination,
  ) => {
    void invalidateFileScope(c.client, c.projectId);
    const revision = await c.prepareCanvasForAgent();
    const current = c.readCanvas().nodes;
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
          c.readCanvas().edges,
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
    setTab("workbench");
  };
  const saveCategories = async (next: VisualMaterialCategory[]) => {
    setPending(true);
    setNotice("");
    try {
      const revision = await c.prepareCanvasForAgent();
      const updated = await putVisualCanvas(
        c.projectId,
        c.readCanvas().nodes,
        revision,
        c.readCanvas().edges,
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
    <div
      className={`visual-project-board${embedded ? " is-embedded" : ""}${view === "canvas" ? " is-canvas-view" : ""}`}
    >
      <TransferFeedback progress={transfer.progress} />
      {!embedded && (
        <VisualProjectHeader
          workspace="workbench"
          projectTitle={c.projectQuery.data?.title ?? "创作项目"}
          title={c.title}
          editingTitle={c.editingTitle}
          saveState={c.saveState}
          onWorkbench={() => undefined}
          onScript={onScript}
          onPrevis={onPrevis}
          onBack={c.onBack}
          onStartTitleEditing={() => c.setEditingTitle(true)}
          onTitleChange={c.setTitle}
          onSubmitTitle={() => void finishTitle()}
          onBlurTitle={() => void finishTitle()}
        />
      )}
      <div className="board-layout">
        <aside
          id="board-project-materials"
          className="board-materials"
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
          <MaterialViews
            view={activeSection}
            onView={chooseSection}
            onStoryboard={() => chooseSection("storyboard")}
            storyboardCount={storyboard?.count}
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            pinned={pinned}
            onPinnedChange={setPinned}
            ids={c.projectCardIds ?? []}
            fileCount={fileNodes.length}
            search={search}
            onSearch={(value) =>
              activeSection === "storyboard"
                ? storyboard?.onSearch(value)
                : setMaterialSearches((current) => ({
                    ...current,
                    [materialView]: value,
                  }))
            }
            footer={
              <div className="board-material-footer">
                <button onClick={() => c.setAssetsOpen(true)}>
                  <FolderOpen size={15} /> 导入 / 管理素材
                </button>
              </div>
            }
          >
            {activeSection === "storyboard" ? (
              storyboard?.sidebar
            ) : materialView !== "files" ? (
              <CommonDesignCards
                kind={materialView}
                projectId={c.projectId}
                ids={c.projectCardIds ?? []}
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
                  void createCard(c.projectId, {
                    kind,
                    title: `新建${label}卡`,
                  })
                    .then(async (card) => {
                      c.client.setQueryData<Card[]>(cardsKey, (old) => [
                        ...(old ?? []),
                        card,
                      ]);
                      await addCards([card]);
                      setViewCard(card);
                    })
                    .catch((error: unknown) =>
                      setNotice(apiErrorMessage(error)),
                    )
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
                        c.readCanvas().nodes,
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
                      c
                        .readCanvas()
                        .projectCardIds.filter((id) => id !== card.id),
                    )
                    .catch((error: unknown) =>
                      setNotice(apiErrorMessage(error)),
                    );
                }}
              />
            ) : (
              <>
                <div className="board-file-actions">
                  <div className="board-create-split">
                    <button
                      className="board-primary"
                      title={`新建${nodeTypeNames[newKind as keyof typeof nodeTypeNames]}`}
                      disabled={
                        !c.canvasReady || Boolean(c.conflict) || pending
                      }
                      onClick={() =>
                        c.createNode(newKind as keyof typeof nodeTypeNames)
                      }
                    >
                      <Plus size={15} aria-hidden /> 新建
                    </button>
                    <BoardMenu
                      label="选择新建节点类型"
                      triggerClassName="board-create-options"
                      triggerIcon={<ChevronDown size={15} aria-hidden />}
                      items={Object.entries(nodeTypeNames).map(
                        ([kind, label]) => ({
                          label: `新建${label}`,
                          disabled:
                            !c.canvasReady || Boolean(c.conflict) || pending,
                          onSelect: () => {
                            setNewKind(kind);
                            c.createNode(kind as keyof typeof nodeTypeNames);
                          },
                        }),
                      )}
                    />
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
                </div>
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
                  nodes={fileNodes.filter((node) =>
                    `${node.title} ${(node.tags ?? []).join(" ")}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
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
                    setUploadDestination({
                      category_id: categoryId,
                      group: null,
                    })
                  }
                  uploadDisabled={c.upload.isPending || !c.canvasReady}
                />
              </>
            )}
          </MaterialViews>
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
                onOpenPrevis={onPrevis}
                fixedKind={viewCard.kind}
                initialCardId={viewCard.id}
                onCreated={(card) => addCards([card])}
                onCloseCard={() => setViewCard(undefined)}
              />
            </Suspense>
          )}
        </aside>
        <main className="board-main">
          <div className="workbench-local-tools">
            <WorkbenchViewToggle
              view={view}
              onView={
                onView ??
                ((next) => {
                  if (next === "canvas") onCanvas();
                })
              }
            />
            {view === "board" && activeSection !== "storyboard" && (
              <nav className="board-tabs" aria-label="看板内容">
                <button
                  aria-pressed={tab === "workbench"}
                  className={tab === "workbench" ? "active" : ""}
                  onClick={() => setTab("workbench")}
                >
                  <PanelsTopLeft size={15} /> 制作
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
            )}
          </div>
          {notice && (
            <p className="board-notice" role="alert">
              {notice}
            </p>
          )}
          {view === "board" && c.uploadNotice && (
            <p className="board-notice" role="status">
              {c.uploadNotice.message}
            </p>
          )}
          {view === "board" && c.conflict && (
            <div className="board-notice" role="alert">
              项目发生并发更新，本地草稿已保留。
              <button onClick={() => void c.resolveConflict("server")}>
                加载最新项目
              </button>
            </div>
          )}
          {view === "board" && c.saveMessage && (
            <p className="board-notice" role="alert">
              {c.saveMessage}
            </p>
          )}
          {view === "canvas" ? (
            canvasContent
          ) : activeSection === "storyboard" && storyboard ? (
            <div className="board-workbench storyboard-workbench">
              <section className="board-editor">{storyboard.editor}</section>
              {storyboard.output}
            </div>
          ) : !c.canvasReady ? (
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
                      {selectedStatus === "生成中" ? (
                        <GenerationSpinner />
                      ) : (
                        <SelectedStatusIcon size={12} />
                      )}
                      {selectedStatus}
                    </span>
                    <NodeApproval
                      node={selected}
                      onChange={(approved) =>
                        c.patchNode(selected.id, { approved }, true)
                      }
                    />
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
                  key={selected.id}
                  controller={c}
                  node={selected}
                  legacyKind={legacyKind}
                  pending={pending}
                  onLegacyPick={() =>
                    legacyKind &&
                    setCardPicker({ nodeId: selected.id, kind: legacyKind })
                  }
                  onLegacyCreate={() => void createLegacyCard()}
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
                  generating={selectedStatus === "生成中"}
                />
              </section>
              <OutputHistory
                controller={c}
                nodeId={selected.id}
                tasks={tasks.data ?? []}
                batches={batches.data ?? []}
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
