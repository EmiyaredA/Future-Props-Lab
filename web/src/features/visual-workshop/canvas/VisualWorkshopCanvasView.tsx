import { CanvasProjectDesigns } from "./CanvasProjectDesigns";
import type { Card, CardKind } from "../creative/api";
import { canvasBounds } from "./canvasPlacement";
import { ToonflowCanvas } from "./ToonflowCanvas";
import { LoadingState } from "@shared/ui/LoadingState";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { CanvasSelectionActions } from "./CanvasSelectionActions";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { NodeApproval } from "../NodeApproval";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  Copy,
  Image,
  Music,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Video,
} from "lucide-react";
import { uploadManagedFile } from "@features/files";
import { CanvasAssetsDrawer } from "@features/visual-workshop/canvas/CanvasAssetsDrawer";
import { CanvasNodeInspector } from "@features/visual-workshop/canvas/CanvasNodeInspector";
import { CanvasEdgeLayer } from "@features/visual-workshop/canvas/CanvasEdgeLayer";
import {
  CanvasAlignmentGuides,
  CanvasSelectionOverlay,
} from "@features/visual-workshop/canvas/CanvasInteractionOverlay";
import { CanvasScreenChrome } from "@features/visual-workshop/canvas/CanvasScreenChrome";
import {
  CanvasMediaNodeActions,
  CanvasMediaPreview,
} from "@features/visual-workshop/canvas/CanvasMediaNode";
import type { GenerationBatch } from "@features/visual-workshop/api";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import { CanvasMediaPreviewDialog } from "@features/visual-workshop/canvas/CanvasMediaPreviewDialog";
import {
  VisualCanvasFrameExportDialog,
  type VisualCanvasFrameExport,
} from "@features/visual-workshop/canvas/VisualCanvasFrameExportDialog";
import { nodeLabel } from "@features/visual-workshop/canvas/geometry";
import { useVisualCanvasController } from "@features/visual-workshop/canvas/useVisualCanvasController";
import { useImageGridComposition } from "@features/visual-workshop/canvas/useImageGridComposition";
import "@features/visual-workshop/visual-workshop.css";
export function VisualWorkshopCanvasView({
  controller,
  onBoard,
  onStoryboard,
  onPrevis,
  onScript,
  embedded = false,
}: {
  controller: ReturnType<typeof useVisualCanvasController>;
  embedded?: boolean;
  onBoard?: () => void;
  onStoryboard?: () => void;
  onPrevis?: () => void;
  onScript?: () => void;
}) {
  const [designKind, setDesignKind] = useState<CardKind>();
  const [designRequest, setDesignRequest] = useState<{
    nodeId: string;
    card: Card;
  }>();
  const [editingGroupId, setEditingGroupId] = useState<string>();
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const {
    client,
    projectId,
    onBack,
    surface,
    attachSurface,
    uploadInput,
    pan,
    getInsertionAnchor,
    resolveNodePosition,
    revealNodes,
    arrangeNodes,
    canArrange,
    canArrangeSelected,
    canPaste,
    clipboardNotice,
    copyNodes,
    copySelected,
    uploadPosition,
    toolMode,
    setToolMode,
    viewport,
    nodes,
    edges,
    replaceEdges,
    selectedEdgeId,
    setSelectedEdgeId,
    connection,
    selectedId,
    actionsHiddenNodeId,
    setSelectedId,
    selectedNodeIds,
    groups,
    selectedGroup,
    canGroup,
    groupSelection,
    ungroupSelection,
    renameGroup,
    setSelectedNodeIds,
    selectionBox,
    alignmentGuides,
    setMediaEditorTab,
    inspectedNodeId,
    setInspectedNodeId,
    contextMenu,
    setContextMenu,
    assetsOpen,
    setAssetsOpen,
    assetTab,
    setAssetTab,
    assetView,
    setAssetView,
    editingTitle,
    setEditingTitle,
    title,
    setTitle,
    readCanvas,
    resolveConflict,
    saveNow,
    saveState,
    saveMessage,
    conflict,
    projectQuery,
    canvasQuery,
    prepareCanvasForAgent,
    patchNode,
    linkGenerationTask,
    renameMutation,
    upload,
    uploadNotice,
    setZoom,
    resetZoom,
    createNode,
    onAssetDragOver,
    onAssetDrop,
    addCapturedFrameNode,
    addDerivedImageNode,
    removeNode,
    removeEdge,
    canConnect,
    startConnection,
    finishConnection,
    pasteNodes,
    fitView,
    onSurfacePointerDown,
    onSurfacePointerMove,
    stopSurfaceInteraction,
    startNodeDrag,
    moveNode,
    stopNodeDrag,
    consumeSuppressedNodeClick,
    openContextMenu,
  } = controller;
  useEffect(() => {
    setDesignKind(undefined);
  }, [selectedId]);
  const videoElements = useRef(new Map<string, HTMLVideoElement>());
  const [readyVideoIds, setReadyVideoIds] = useState(() => new Set<string>());
  const [frameExport, setFrameExport] = useState<VisualCanvasFrameExport>();
  const [interactiveVideoId, setInteractiveVideoId] = useState<string>();
  const [previewNodeId, setPreviewNodeId] = useState<string>();
  const [connectionHoverTargetId, setConnectionHoverTargetId] =
    useState<string>();
  const skipMenuFocusRestore = useRef(false);
  const closeMenuAfterPicker = useCallback(() => {
    if (!skipMenuFocusRestore.current) return;
    setContextMenu(undefined);
  }, [setContextMenu]);
  useEffect(() => {
    const input = uploadInput.current;
    if (!input) return;
    input.addEventListener("cancel", closeMenuAfterPicker);
    return () => input.removeEventListener("cancel", closeMenuAfterPicker);
  }, [closeMenuAfterPicker, uploadInput]);
  const { openComposition, canComposeSelection, compositionOverlay } =
    useImageGridComposition({
      projectId,
      nodes,
      selectedNodeIds,
      readCanvas,
      prepareCanvas: prepareCanvasForAgent,
      resolveNodePosition,
      revealNodes,
      client,
      setSelectedNodeIds,
      setInspectedNodeId,
      setAssetsOpen,
    });
  useEffect(() => {
    if (interactiveVideoId && interactiveVideoId !== selectedId)
      setInteractiveVideoId(undefined);
  }, [interactiveVideoId, selectedId]);
  useEffect(() => {
    if (!connection) setConnectionHoverTargetId(undefined);
  }, [connection]);
  const registerVideo = useCallback(
    (nodeId: string, video: HTMLVideoElement | null) => {
      if (video) videoElements.current.set(nodeId, video);
      else videoElements.current.delete(nodeId);
      setReadyVideoIds((current) => {
        if (current.has(nodeId) === Boolean(video)) return current;
        const next = new Set(current);
        if (video) next.add(nodeId);
        else next.delete(nodeId);
        return next;
      });
    },
    [],
  );
  if (projectQuery.isLoading || canvasQuery.isLoading)
    return (
      <div className="canvas-state">
        <TransferFeedback progress={activeTransferProgress} />

        <LoadingState label="正在打开画布…" variant="inline" />
      </div>
    );
  if (!projectQuery.data || (!canvasQuery.data && canvasQuery.isError))
    return (
      <div className="canvas-state">
        <TransferFeedback progress={activeTransferProgress} />

        <strong>项目不存在或暂时无法读取</strong>
        <button onClick={onBack}>
          <ArrowLeft aria-hidden />
          返回项目列表
        </button>
      </div>
    );
  const previewNode = nodes.find(
    (node): node is Exclude<(typeof nodes)[number], { kind: "text" }> =>
      node.id === previewNodeId && node.kind !== "text",
  );

  const world = (
    <>
      {groups.map((group) => {
        const ids = new Set(group.node_ids);
        const members = nodes.filter((node) => ids.has(node.id));
        if (members.length < 2) return null;
        const bounds = canvasBounds(members);
        const active = selectedGroup?.id === group.id;
        return (
          <div
            className={`visual-canvas-group${active ? " is-selected" : ""}`}
            key={group.id}
            style={{
              left: bounds.x - 20,
              top: bounds.y - 45,
              width: bounds.width + 40,
              height: bounds.height + 65,
            }}
          >
            <div
              className="visual-canvas-group-handle"
              tabIndex={0}
              role="button"
              aria-label={`选择分组 ${group.title}`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  controller.setSelectedNodeIds(group.node_ids);
                }
              }}
              onPointerDown={(event) => {
                setInspectedNodeId(undefined);
                startNodeDrag(event, members[0]!, group.node_ids);
              }}
              onPointerMove={moveNode}
              onPointerUp={stopNodeDrag}
              onPointerCancel={stopNodeDrag}
            >
              {editingGroupId === group.id ? (
                <input
                  aria-label="分组名称"
                  maxLength={120}
                  defaultValue={group.title}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => {
                    renameGroup(group.id, event.currentTarget.value);
                    setEditingGroupId(undefined);
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.currentTarget.value = group.title;
                      event.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <strong>{group.title}</strong>
              )}
              <small>{group.node_ids.length} 个节点</small>
            </div>
            {active && (
              <button
                className="visual-canvas-group-rename"
                type="button"
                aria-label="重命名分组"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setEditingGroupId(group.id);
                }}
              >
                <Pencil size={16} aria-hidden />
              </button>
            )}
          </div>
        );
      })}
      <CanvasAlignmentGuides guides={alignmentGuides} />
      <CanvasEdgeLayer
        nodes={nodes}
        edges={edges}
        selectedEdgeId={selectedEdgeId}
        connection={connection}
        onSelectEdge={(edgeId) => {
          setSelectedId(undefined);
          setSelectedEdgeId(edgeId);
        }}
        onRemoveEdge={removeEdge}
      />
      {nodes.map((node) => {
        const selected = selectedNodeIds.includes(node.id);
        const focused = node.id === selectedId;
        const showNodeActions = focused && actionsHiddenNodeId !== node.id;
        const connectionClass =
          connection?.sourceNodeId === node.id
            ? " is-connection-source"
            : connection && connectionHoverTargetId === node.id
              ? canConnect(connection.sourceNodeId, node.id)
                ? " is-connectable-target"
                : " is-unavailable-target"
              : "";
        return (
          <article
            className={`canvas-node ${node.kind}${selected ? " selected" : ""}${connectionClass}`}
            style={{ left: node.position.x, top: node.position.y }}
            data-node-id={node.id}
            data-amadeus-id={node.id}
            data-amadeus-name={node.title || nodeLabel(node.kind)}
            data-amadeus-value={nodeLabel(node.kind)}
            key={node.id}
            onPointerDown={(event) => {
              startNodeDrag(event, node);
              if (event.defaultPrevented)
                surface.current?.focus({ preventScroll: true });
            }}
            onPointerMove={moveNode}
            onPointerUp={stopNodeDrag}
            onPointerCancel={stopNodeDrag}
            onClick={(event) => {
              event.stopPropagation();
              if (consumeSuppressedNodeClick(node.id)) return;
              setSelectedId(node.id);
              setSelectedEdgeId(undefined);
              setAssetsOpen(false);
            }}
            onDoubleClick={(event) => {
              if (node.kind === "text") return;
              event.preventDefault();
              event.stopPropagation();
              setSelectedId(node.id);
              setInspectedNodeId(undefined);
              setPreviewNodeId(node.id);
            }}
          >
            <header>
              {node.kind === "image" ? (
                <Image className="canvas-node-kind-icon" aria-hidden />
              ) : node.kind === "video" ? (
                <Video className="canvas-node-kind-icon" aria-hidden />
              ) : node.kind === "audio" ? (
                <Music className="canvas-node-kind-icon" aria-hidden />
              ) : null}
              {focused ? (
                <input
                  aria-label="节点标题"
                  maxLength={120}
                  value={node.title}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    patchNode(node.id, { title: event.target.value })
                  }
                  onBlur={() => {
                    saveNow();
                  }}
                />
              ) : (
                <strong>{node.title}</strong>
              )}
              {!focused && (node.kind === "image" || node.kind === "video") ? (
                <Pencil className="canvas-node-title-edit" aria-hidden />
              ) : null}
              <NodeApproval
                node={node}
                compact
                onChange={(approved) => patchNode(node.id, { approved }, true)}
              />
              {showNodeActions && node.kind === "text" ? (
                <span className="canvas-node-actions">
                  <button
                    aria-label="复制节点"
                    title="复制节点"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      copyNodes([node.id]);
                    }}
                  >
                    <Copy aria-hidden />
                  </button>
                  <button
                    aria-label="删除节点"
                    title="删除节点"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeNode(node.id);
                    }}
                  >
                    <Trash2 aria-hidden />
                  </button>
                </span>
              ) : showNodeActions && node.kind !== "text" ? (
                <CanvasMediaNodeActions
                  node={node}
                  canExportFrame={
                    node.kind === "video" && readyVideoIds.has(node.id)
                  }
                  onExportFrame={() => {
                    if (node.kind !== "video") return;
                    const video = videoElements.current.get(node.id);
                    if (!video) return;
                    video.pause();
                    setFrameExport({
                      node,
                      video,
                      capturedAt: video.currentTime,
                    });
                  }}
                  onReplace={() => {
                    setSelectedId(node.id);
                    setInspectedNodeId(node.id);
                    setMediaEditorTab("content");
                    setAssetsOpen(false);
                  }}
                  onPreview={
                    node.kind === "video"
                      ? () => setInteractiveVideoId(node.id)
                      : () => setPreviewNodeId(node.id)
                  }
                  onCopy={() => {
                    copyNodes([node.id]);
                  }}
                  onCompose={
                    node.kind === "image"
                      ? () => openComposition([node.id])
                      : undefined
                  }
                  onDelete={() => removeNode(node.id)}
                />
              ) : null}
            </header>
            {node.kind === "text" ? (
              <textarea
                aria-label={`${node.title}内容`}
                maxLength={20_000}
                placeholder="输入文本…"
                value={node.text}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) =>
                  patchNode(node.id, { text: event.target.value })
                }
                onBlur={() => {
                  saveNow();
                }}
              />
            ) : (
              <div className="canvas-node-media">
                <CanvasMediaPreview
                  node={node}
                  interactive={interactiveVideoId === node.id}
                  onVideoReadyChange={(video) => registerVideo(node.id, video)}
                />
                <button
                  type="button"
                  className="canvas-media-replace"
                  aria-label={
                    node.asset_id
                      ? `替换${nodeLabel(node.kind)}素材`
                      : `选择${nodeLabel(node.kind)}素材`
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(node.id);
                    setInspectedNodeId(node.id);
                    setMediaEditorTab("content");
                    setAssetsOpen(false);
                  }}
                >
                  <RefreshCw aria-hidden />
                  {node.asset_id ? "替换" : "选择素材"}
                </button>
              </div>
            )}
            {node.kind !== "text" ? (
              <>
                <button
                  type="button"
                  className={`canvas-node-port is-input${
                    connection &&
                    connectionHoverTargetId === node.id &&
                    canConnect(connection.sourceNodeId, node.id)
                      ? " is-valid-target"
                      : ""
                  }`}
                  aria-label={`连接到${node.title}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerEnter={() => {
                    if (connection) setConnectionHoverTargetId(node.id);
                  }}
                  onPointerLeave={() =>
                    setConnectionHoverTargetId((current) =>
                      current === node.id ? undefined : current,
                    )
                  }
                  onPointerUp={(event) => {
                    setConnectionHoverTargetId(undefined);
                    finishConnection(event, node.id);
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Plus aria-hidden />
                </button>
                <button
                  type="button"
                  className="canvas-node-port is-output"
                  aria-label={`从${node.title}创建连线`}
                  onPointerDown={(event) => startConnection(event, node.id)}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Plus aria-hidden />
                </button>
              </>
            ) : null}
            {focused && inspectedNodeId === node.id && node.kind !== "text" ? (
              <CanvasNodeInspector
                portalHost={surface.current?.parentElement}
                designReferenceRequest={
                  designRequest?.nodeId === inspectedNodeId
                    ? {
                        card: designRequest.card,
                        handled: () => setDesignRequest(undefined),
                      }
                    : undefined
                }
                referenceContext={{
                  nodes,
                  edges,
                  replaceEdges,
                  removeEdge,
                  projectCardIds: controller.projectCardIds,
                  registerReferenceImage: controller.registerReferenceImage,
                  collectCard: (card) =>
                    controller.replaceProjectCardIds([
                      ...new Set([
                        ...controller.readCanvas().projectCardIds,
                        card.id,
                      ]),
                    ]),
                }}
                embedded
                projectId={projectId}
                node={node}
                upstreamNodes={edges
                  .filter((edge) => edge.target_node_id === node.id)
                  .flatMap((edge) => {
                    const upstream = nodes.find(
                      (item) => item.id === edge.source_node_id,
                    );
                    return upstream && upstream.kind !== "text"
                      ? [upstream]
                      : [];
                  })}
                onClose={() => setInspectedNodeId(undefined)}
                onPrepareCanvas={prepareCanvasForAgent}
                onPatch={(patch, immediate) =>
                  patchNode(node.id, patch, immediate)
                }
                onTaskLinked={(taskId) => linkGenerationTask(node.id, taskId)}
                onBatchCreated={async (batch: GenerationBatch) => {
                  if (batch.grid_output === "composite") {
                    patchNode(
                      node.id,
                      {
                        generation_batch_id: batch.id,
                        generation_task_id: null,
                      },
                      true,
                    );
                  }
                  await client.invalidateQueries({
                    queryKey: visualWorkshopQueryKeys.canvas(projectId),
                  });
                }}
              />
            ) : null}
          </article>
        );
      })}
    </>
  );
  return (
    <div className="visual-canvas">
      <TransferFeedback progress={activeTransferProgress} />

      <div
        ref={attachSurface}
        role="region"
        aria-label="节点画布"
        tabIndex={-1}
        className={`visual-canvas-surface tool-${toolMode}${pan.current ? " is-dragging" : ""}${selectionBox ? " is-selecting" : ""}`}
        style={{
          ...({
            "--canvas-ui-scale": 1 / viewport.zoom,
            "--canvas-media-actions-top": `${-54 / viewport.zoom}px`,
            "--canvas-inspector-gap": `${22 / viewport.zoom}px`,
          } as CSSProperties),
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
        }}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={stopSurfaceInteraction}
        onPointerCancel={stopSurfaceInteraction}
        onContextMenu={openContextMenu}
        onDragOver={onAssetDragOver}
        onDrop={(event) => {
          void onAssetDrop(event);
        }}
      >
        <CanvasScreenChrome
          embedded={embedded}
          onBoard={onBoard}
          onPrevis={onPrevis}
          onScript={onScript}
          onStoryboard={onStoryboard}
          projectTitle={projectQuery.data.title}
          title={title}
          editingTitle={editingTitle}
          saveState={saveState}
          assetsOpen={assetsOpen}
          designKind={designKind}
          onDesign={(kind) => {
            setAssetsOpen(false);
            setDesignKind((current) => (current === kind ? undefined : kind));
          }}
          createMenuOpen={!!contextMenu}
          onBack={onBack}
          onStartTitleEditing={() => setEditingTitle(true)}
          onTitleChange={setTitle}
          onSubmitTitle={() => {
            if (title.trim()) renameMutation.mutate();
          }}
          onBlurTitle={() => {
            if (title.trim() && title !== projectQuery.data.title)
              renameMutation.mutate();
            else setEditingTitle(false);
          }}
          onCreate={(event) => {
            if (contextMenu) {
              setContextMenu(undefined);
              return;
            }
            const surfaceBounds = surface.current?.getBoundingClientRect();
            const buttonBounds = event.currentTarget.getBoundingClientRect();
            if (!surfaceBounds) return;
            const menuWidth = 164;
            const menuHeight = 246;
            const gap = 10;
            const anchor = getInsertionAnchor();
            setContextMenu({
              left: Math.max(
                8,
                Math.min(
                  buttonBounds.right - surfaceBounds.left + gap,
                  surfaceBounds.width - menuWidth - 8,
                ),
              ),
              top: Math.max(
                8,
                Math.min(
                  buttonBounds.top - surfaceBounds.top,
                  surfaceBounds.height - menuHeight - 8,
                ),
              ),
              worldX: anchor.x,
              worldY: anchor.y,
              viewportAnchor: true,
            });
          }}
          onToggleAssets={() => {
            setDesignKind(undefined);
            setSelectedId(undefined);
            setAssetsOpen((value) => !value);
          }}
          controls={{
            assetsOpen,
            toolMode,
            setToolMode,
            viewport,
            setZoom,
            resetZoom,
            fitView,
            canArrange,
            onArrange: arrangeNodes,
          }}
        />
        <CanvasSelectionOverlay selectionBox={selectionBox} />
        <CanvasSelectionActions
          count={selectedNodeIds.length}
          groupSelected={Boolean(selectedGroup)}
          onGroup={canGroup ? groupSelection : undefined}
          onUngroup={selectedGroup ? ungroupSelection : undefined}
          onCopy={copySelected}
          canArrange={canArrangeSelected}
          onArrange={(mode) => arrangeNodes(mode, true)}
          onCompose={
            canComposeSelection
              ? () => openComposition(selectedNodeIds)
              : undefined
          }
        />
        <ToonflowCanvas viewport={viewport}>{world}</ToonflowCanvas>
      </div>
      <input
        ref={uploadInput}
        hidden
        multiple
        type="file"
        accept="image/*,video/*,audio/*"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.currentTarget.value = "";
          if (skipMenuFocusRestore.current) setContextMenu(undefined);
          if (files.length) upload.mutate(files);
        }}
      />
      {contextMenu ? (
        <CanvasContextMenu
          position={contextMenu}
          onCreate={(kind, point) =>
            createNode(kind, contextMenu.viewportAnchor ? undefined : point)
          }
          onFit={fitView}
          onPaste={pasteNodes}
          canPaste={canPaste}
          onCopy={copySelected}
          canCopy={selectedNodeIds.length > 0}
          skipFocusRestoreRef={skipMenuFocusRestore}
          onClose={() => {
            skipMenuFocusRestore.current = false;
            setContextMenu(undefined);
          }}
          onUpload={(point) => {
            uploadPosition.current = contextMenu.viewportAnchor
              ? undefined
              : point;
            skipMenuFocusRestore.current = true;
            uploadInput.current?.click();
          }}
        />
      ) : null}
      {designKind && (
        <CanvasProjectDesigns
          controller={controller}
          kind={designKind}
          onClose={() => setDesignKind(undefined)}
          onUse={(card) => {
            const node = nodes.find((item) => item.id === selectedId);
            if (node?.kind !== "video") return;
            setDesignRequest({ nodeId: node.id, card });
            setInspectedNodeId(node.id);
            setDesignKind(undefined);
          }}
        />
      )}
      {!embedded && assetsOpen ? (
        <CanvasAssetsDrawer
          projectId={projectId}
          assetTab={assetTab}
          onAssetTabChange={setAssetTab}
          assetView={assetView}
          onAssetViewChange={setAssetView}
          onClose={() => setAssetsOpen(false)}
        />
      ) : null}
      {previewNode ? (
        <CanvasMediaPreviewDialog
          key={previewNode.id}
          onAddCroppedImage={async (asset) => {
            try {
              await addDerivedImageNode(previewNode.id, asset);
            } catch (error) {
              if (readCanvas().conflict) setPreviewNodeId(undefined);
              throw error;
            }
          }}
          projectId={projectId}
          node={previewNode}
          onClose={() => setPreviewNodeId(undefined)}
          onSetCurrent={(assetId, taskId) =>
            patchNode(
              previewNodeId!,
              { asset_id: assetId, generation_task_id: taskId },
              true,
            )
          }
        />
      ) : null}
      {frameExport ? (
        <VisualCanvasFrameExportDialog
          frameExport={frameExport}
          onClose={() => setFrameExport(undefined)}
          onSave={async (file) => {
            const asset = await runTransfer((onProgress) =>
              uploadManagedFile(file, projectId, undefined, undefined, {
                onProgress,
              }),
            );
            await addCapturedFrameNode(frameExport.node.id, asset);
          }}
        />
      ) : null}
      {compositionOverlay}
      {conflict ? (
        <div className="canvas-conflict" role="alert">
          <span>
            <strong>画布存在更新冲突</strong>
            本地草稿仍保留，请选择要使用的版本。
          </span>
          <button onClick={() => void resolveConflict("server")}>
            载入服务器版本
          </button>
          <button
            className="danger"
            onClick={() => void resolveConflict("local")}
          >
            用本地版本覆盖
          </button>
        </div>
      ) : null}
      {saveMessage ? (
        <div className="canvas-save-error">{saveMessage}</div>
      ) : null}
      {clipboardNotice ? (
        <div
          className={`canvas-upload-notice is-${clipboardNotice.tone}`}
          style={uploadNotice ? { bottom: 80 } : undefined}
          role={clipboardNotice.tone === "error" ? "alert" : "status"}
          aria-label="画布复制粘贴状态"
        >
          {clipboardNotice.message}
        </div>
      ) : null}
      {uploadNotice ? (
        <div
          className={`canvas-upload-notice is-${uploadNotice.tone}`}
          role={uploadNotice.tone === "error" ? "alert" : "status"}
          aria-label="上传状态"
        >
          {uploadNotice.message}
        </div>
      ) : null}
    </div>
  );
}
