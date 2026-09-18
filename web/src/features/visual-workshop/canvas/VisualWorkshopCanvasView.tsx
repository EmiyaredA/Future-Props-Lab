import { CanvasContextMenu } from "./CanvasContextMenu";
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
import { ProjectAssistantPanel } from "@features/visual-workshop/assistant/ProjectAssistantPanel";
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
}: {
  controller: ReturnType<typeof useVisualCanvasController>;
}) {
  const {
    client,
    projectId,
    onBack,
    surface,
    uploadInput,
    pan,
    revisionRef,
    nodesRef,
    edgesRef,
    conflictRef,
    saveFailureRef,
    autoSave,
    clipboard,
    uploadPosition,
    toolMode,
    setToolMode,
    viewport,
    nodes,
    setNodes,
    edges,
    setEdges,
    selectedEdgeId,
    setSelectedEdgeId,
    connection,
    selectedId,
    actionsHiddenNodeId,
    setSelectedId,
    selectedNodeIds,
    setSelectedNodeIds,
    selectionBox,
    alignmentGuides,
    mediaEditorTab,
    setMediaEditorTab,
    inspectedNodeId,
    setInspectedNodeId,
    contextMenu,
    setContextMenu,
    assetsOpen,
    setAssetsOpen,
    assistantOpen,
    setAssistantOpen,
    assetTab,
    setAssetTab,
    assetView,
    setAssetView,
    editingTitle,
    setEditingTitle,
    title,
    setTitle,
    saveState,
    setSaveState,
    saveMessage,
    conflict,
    setConflict,
    projectQuery,
    canvasQuery,
    enqueueSave,
    clearHistory,
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
    pasteNode,
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
  const { openComposition, selectionToolbar, compositionOverlay } =
    useImageGridComposition({
      projectId,
      nodes,
      selectedNodeIds,
      revisionRef,
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
        <strong>正在打开画布…</strong>
      </div>
    );
  if (projectQuery.isError || !projectQuery.data || canvasQuery.isError)
    return (
      <div className="canvas-state">
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

  return (
    <div className={`visual-canvas${assistantOpen ? " has-assistant" : ""}`}>
      <div
        ref={surface}
        className={`visual-canvas-surface tool-${toolMode}${pan.current ? " is-dragging" : ""}${selectionBox ? " is-selecting" : ""}`}
        style={{
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
          projectTitle={projectQuery.data.title}
          title={title}
          editingTitle={editingTitle}
          saveState={saveState}
          assistantOpen={assistantOpen}
          assetsOpen={assetsOpen}
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
            const surfaceBounds = surface.current?.getBoundingClientRect();
            const buttonBounds = event.currentTarget.getBoundingClientRect();
            if (!surfaceBounds) return;
            const menuWidth = 164;
            const menuHeight = 246;
            const gap = 10;
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
              worldX: (innerWidth / 2 - viewport.x) / viewport.zoom,
              worldY: (innerHeight / 2 - viewport.y) / viewport.zoom,
            });
          }}
          onToggleAssistant={() => {
            if (innerWidth <= 1200) {
              setAssetsOpen(false);
              setSelectedId(undefined);
            }
            setAssistantOpen((value) => !value);
          }}
          onToggleAssets={() => {
            if (innerWidth <= 1200) setAssistantOpen(false);
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
          }}
        />
        <CanvasSelectionOverlay selectionBox={selectionBox} />
        {selectionToolbar}
        <div
          className="visual-canvas-world"
          style={
            {
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
              "--canvas-ui-scale": 1 / viewport.zoom,
              "--canvas-media-actions-top": `${-43 / viewport.zoom}px`,
              "--canvas-inspector-gap": `${22 / viewport.zoom}px`,
            } as CSSProperties
          }
        >
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
                key={node.id}
                onPointerDown={(event) => startNodeDrag(event, node)}
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
                        if (autoSave.current) clearTimeout(autoSave.current);
                        enqueueSave(nodesRef.current);
                      }}
                    />
                  ) : (
                    <strong>{node.title}</strong>
                  )}
                  {!focused &&
                  (node.kind === "image" || node.kind === "video") ? (
                    <Pencil className="canvas-node-title-edit" aria-hidden />
                  ) : null}
                  {showNodeActions && node.kind === "text" ? (
                    <span className="canvas-node-actions">
                      <button
                        aria-label="复制节点"
                        title="复制节点"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          clipboard.current = structuredClone(node);
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
                          : undefined
                      }
                      onCopy={() => {
                        clipboard.current = structuredClone(node);
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
                      if (autoSave.current) clearTimeout(autoSave.current);
                      enqueueSave(nodesRef.current);
                    }}
                  />
                ) : (
                  <div className="canvas-node-media">
                    <CanvasMediaPreview
                      node={node}
                      interactive={interactiveVideoId === node.id}
                      onVideoReadyChange={(video) =>
                        registerVideo(node.id, video)
                      }
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
                {focused &&
                inspectedNodeId === node.id &&
                node.kind !== "text" ? (
                  <CanvasNodeInspector
                    embedded
                    initialTab={mediaEditorTab}
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
                    onTaskLinked={(taskId) =>
                      linkGenerationTask(node.id, taskId)
                    }
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
        </div>
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
          onCreate={createNode}
          onFit={fitView}
          onPaste={pasteNode}
          canPaste={!!clipboard.current}
          skipFocusRestoreRef={skipMenuFocusRestore}
          onClose={() => {
            skipMenuFocusRestore.current = false;
            setContextMenu(undefined);
          }}
          onUpload={(point) => {
            uploadPosition.current = point;
            skipMenuFocusRestore.current = true;
            uploadInput.current?.click();
          }}
        />
      ) : null}
      {assetsOpen ? (
        <CanvasAssetsDrawer
          projectId={projectId}
          assetTab={assetTab}
          onAssetTabChange={setAssetTab}
          assetView={assetView}
          onAssetViewChange={setAssetView}
          onClose={() => setAssetsOpen(false)}
        />
      ) : null}
      <ProjectAssistantPanel
        projectId={projectId}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        prepareCanvas={prepareCanvasForAgent}
      />
      {previewNode ? (
        <CanvasMediaPreviewDialog
          key={previewNode.id}
          onAddCroppedImage={async (asset) => {
            try {
              await addDerivedImageNode(previewNode.id, asset);
            } catch (error) {
              if (conflictRef.current) setPreviewNodeId(undefined);
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
            const asset = await uploadManagedFile(file, projectId);
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
          <button
            onClick={() => {
              nodesRef.current = conflict.nodes;
              edgesRef.current = conflict.edges;
              revisionRef.current = conflict.revision;
              conflictRef.current = false;
              saveFailureRef.current = "";
              clearHistory();
              setNodes(conflict.nodes);
              setEdges(conflict.edges);
              setConflict(undefined);
              setSaveState("saved");
            }}
          >
            载入服务器版本
          </button>
          <button
            className="danger"
            onClick={() => {
              revisionRef.current = conflict.revision;
              conflictRef.current = false;
              saveFailureRef.current = "";
              setConflict(undefined);
              enqueueSave(nodesRef.current);
            }}
          >
            用本地版本覆盖
          </button>
        </div>
      ) : null}
      {saveMessage ? (
        <div className="canvas-save-error">{saveMessage}</div>
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
