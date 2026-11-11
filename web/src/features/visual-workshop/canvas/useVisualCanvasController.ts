import {
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  invalidateFileScope,
  type AssetViewMode,
  type ManagedFile,
} from "@features/files";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import {
  DEFAULT_VIEWPORT,
  clampZoom,
  nextNodeId,
  nodeLabel,
  readViewport,
  type NodeKind,
  type Viewport,
} from "@features/visual-workshop/canvas/geometry";
import {
  getVisualCanvas,
  getVisualWorkshopProject,
  patchVisualWorkshopProject,
  type VisualCanvasEdge,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import type { VisualWorkshopCanvasPageProps } from "@features/visual-workshop/canvas/visualCanvasTypes";
import {
  canConnectCanvasNodes,
  removeDisconnectedEdgeReferences,
} from "@features/visual-workshop/canvas/canvasGraph";
import { fitCanvasViewport } from "@features/visual-workshop/canvas/canvasFit";
import { useCanvasPersistence } from "@features/visual-workshop/canvas/useCanvasPersistence";
import { useCanvasPointerInteractions } from "@features/visual-workshop/canvas/useCanvasPointerInteractions";
import { useCanvasUpload } from "@features/visual-workshop/canvas/useCanvasUpload";
import { useCanvasAssetDrop } from "@features/visual-workshop/canvas/useCanvasAssetDrop";
import { useCanvasKeyboardShortcuts } from "@features/visual-workshop/canvas/useCanvasKeyboardShortcuts";

import { useCanvasClipboard } from "./useCanvasClipboard";

import { derivedImageNode } from "./derivedImageNode";
import { useCanvasSpatialActions } from "./useCanvasSpatialActions";

type ContextMenuState = {
  left: number;
  top: number;
  worldX: number;
  worldY: number;
  viewportAnchor?: boolean;
};

export function zoomViewportAt(
  viewport: Viewport,
  nextZoom: number,
  anchorX: number,
  anchorY: number,
): Viewport {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / viewport.zoom;
  return {
    zoom,
    x: anchorX - (anchorX - viewport.x) * ratio,
    y: anchorY - (anchorY - viewport.y) * ratio,
  };
}

export function useVisualCanvasController({
  projectId,
  onBack,
}: VisualWorkshopCanvasPageProps) {
  const client = useQueryClient();
  const surface = useRef<HTMLDivElement>(null);
  const [surfaceElement, setSurfaceElement] = useState<HTMLDivElement | null>(
    null,
  );
  const attachSurface = useCallback((element: HTMLDivElement | null) => {
    surface.current = element;
    setSurfaceElement(element);
  }, []);
  const uploadInput = useRef<HTMLInputElement>(null);
  const lastPointerClient = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const lastPointer = useRef({ x: 0, y: 0 });
  const uploadPosition = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const gestureViewport = useRef<Viewport | undefined>(undefined);
  const [viewport, setViewport] = useState(() => readViewport(projectId));
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [connection, setConnection] = useState<{
    sourceNodeId: string;
    x: number;
    y: number;
  }>();
  const [mediaEditorTab, setMediaEditorTab] = useState<"content" | "generate">(
    "generate",
  );
  const [inspectedNodeId, setInspectedNodeId] = useState<string>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [assetTab, setAssetTab] = useState<"project" | "cross" | "library">(
    "project",
  );
  const [assetView, setAssetView] = useState<AssetViewMode>("list");
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const projectQuery = useQuery({
    queryKey: visualWorkshopQueryKeys.project(projectId),
    queryFn: () => getVisualWorkshopProject(projectId),
  });
  const canvasQuery = useQuery({
    queryKey: visualWorkshopQueryKeys.canvas(projectId),
    queryFn: () => getVisualCanvas(projectId),
  });
  const canvasReady = Boolean(projectQuery.data && canvasQuery.data);
  const {
    revisionRef,
    nodesRef,
    edgesRef,
    conflictRef,
    saveFailureRef,
    autoSave,
    nodes,
    setNodes,
    edges,
    setEdges,
    saveState,
    setSaveState,
    saveMessage,
    setSaveMessage,
    conflict,
    setConflict,
    enqueueSave,
    recordHistory,
    clearHistory,
    undo,
    redo,
    prepareCanvasForAgent,
    applyServerCanvas,
    replaceNodes,
    patchNode,
    replaceEdges,
  } = useCanvasPersistence(projectId, canvasQuery.data);

  useEffect(() => {
    if (projectQuery.data && !editingTitle) setTitle(projectQuery.data.title);
  }, [editingTitle, projectQuery.data]);
  useEffect(() => {
    window.localStorage.setItem(
      `fpl_canvas_viewport_${projectId}`,
      JSON.stringify(viewport),
    );
  }, [projectId, viewport]);
  const addEdge = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      const edge: VisualCanvasEdge = {
        id: `edge-${crypto.randomUUID()}`,
        source_node_id: sourceNodeId,
        target_node_id: targetNodeId,
      };
      replaceEdges((current) => [...current, edge], true);
      setSelectedEdgeId(edge.id);
    },
    [replaceEdges],
  );
  const commitCanvasSnapshot = useCallback(
    (nextNodes: VisualCanvasNode[], nextEdges: VisualCanvasEdge[]) => {
      if (autoSave.current) {
        clearTimeout(autoSave.current);
        autoSave.current = undefined;
      }
      recordHistory({ nodes: nodesRef.current, edges: edgesRef.current });
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      enqueueSave(nextNodes, nextEdges);
    },
    [
      autoSave,
      edgesRef,
      enqueueSave,
      nodesRef,
      recordHistory,
      setEdges,
      setNodes,
    ],
  );
  const removeEdge = useCallback(
    (edgeId: string) => {
      const edge = edgesRef.current.find((item) => item.id === edgeId);
      if (edge) {
        const nextEdges = edgesRef.current.filter((item) => item.id !== edgeId);
        const nextNodes = removeDisconnectedEdgeReferences(
          nodesRef.current,
          edgesRef.current,
          [edgeId],
        );
        commitCanvasSnapshot(nextNodes, nextEdges);
      }
      setSelectedEdgeId((current) =>
        current === edgeId ? undefined : current,
      );
    },
    [commitCanvasSnapshot, edgesRef, nodesRef],
  );
  const canConnect = useCallback(
    (sourceNodeId: string, targetNodeId: string) =>
      canConnectCanvasNodes(
        nodesRef.current,
        edgesRef.current,
        sourceNodeId,
        targetNodeId,
      ),
    [edgesRef, nodesRef],
  );
  const linkGenerationTask = useCallback(
    (nodeId: string, taskId: string) => {
      if (autoSave.current) {
        clearTimeout(autoSave.current);
        autoSave.current = undefined;
      }
      recordHistory({ nodes: nodesRef.current, edges: edgesRef.current });
      const next = nodesRef.current.map((node) =>
        node.id === nodeId && node.kind !== "text"
          ? ({
              ...node,
              generation_task_id: taskId,
            } as VisualCanvasNode)
          : node,
      );
      nodesRef.current = next;
      revisionRef.current += 1;
      setNodes(next);
      setSaveState("saved");
      setSaveMessage("");
      void client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.canvas(projectId),
      });
    },
    [
      autoSave,
      client,
      nodesRef,
      edgesRef,
      projectId,
      recordHistory,
      revisionRef,
      setNodes,
      setSaveMessage,
      setSaveState,
    ],
  );

  useEffect(() => {
    if (!canvasReady || !surfaceElement) return;
    const element = surfaceElement;
    const handleWheel = (event: globalThis.WheelEvent) => {
      const gestureWheel = event.ctrlKey || event.metaKey;
      if (
        !gestureWheel &&
        event.target instanceof Element &&
        event.target.closest('[data-canvas-wheel="content"]')
      ) {
        return;
      }
      event.preventDefault();
      setContextMenu(undefined);
      const bounds = element.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      setViewport((current) => {
        const factor = gestureWheel
          ? Math.exp(-event.deltaY * 0.01)
          : event.deltaY > 0
            ? 0.9
            : 1.1;
        return zoomViewportAt(
          current,
          current.zoom * factor,
          pointerX,
          pointerY,
        );
      });
    };
    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      gestureViewport.current = undefined;
      setViewport((current) => {
        gestureViewport.current = current;
        return current;
      });
    };
    const handleGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & {
        scale?: number;
        clientX?: number;
        clientY?: number;
      };
      const bounds = element.getBoundingClientRect();
      const anchorX =
        typeof gesture.clientX === "number"
          ? gesture.clientX - bounds.left
          : bounds.width / 2;
      const anchorY =
        typeof gesture.clientY === "number"
          ? gesture.clientY - bounds.top
          : bounds.height / 2;
      setViewport((current) => {
        const initial = gestureViewport.current ?? current;
        gestureViewport.current = initial;
        return zoomViewportAt(
          initial,
          initial.zoom * (gesture.scale ?? 1),
          anchorX,
          anchorY,
        );
      });
    };
    const handleGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureViewport.current = undefined;
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("gesturestart", handleGestureStart, {
      passive: false,
    });
    element.addEventListener("gesturechange", handleGestureChange, {
      passive: false,
    });
    element.addEventListener("gestureend", handleGestureEnd, {
      passive: false,
    });
    return () => {
      gestureViewport.current = undefined;
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("gesturestart", handleGestureStart);
      element.removeEventListener("gesturechange", handleGestureChange);
      element.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [canvasReady, surfaceElement]);

  const renameMutation = useMutation({
    mutationFn: () =>
      projectQuery.data
        ? patchVisualWorkshopProject(projectQuery.data, { title: title.trim() })
        : Promise.reject(new Error("项目尚未加载")),
    onSuccess: (updated) => {
      client.setQueryData(visualWorkshopQueryKeys.project(projectId), updated);
      void client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.projects,
      });
      setTitle(updated.title);
      setEditingTitle(false);
    },
  });
  const setZoom = useCallback((zoom: number) => {
    const bounds = surface.current?.getBoundingClientRect();
    setViewport((current) =>
      zoomViewportAt(
        current,
        zoom,
        bounds?.width ? bounds.width / 2 : 0,
        bounds?.height ? bounds.height / 2 : 0,
      ),
    );
  }, []);
  const resetZoom = useCallback(() => setZoom(1), [setZoom]);
  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = surface.current?.getBoundingClientRect();
      if (!bounds) return { x: 0, y: 0 };
      return {
        x: (clientX - bounds.left - viewport.x) / viewport.zoom,
        y: (clientY - bounds.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );
  const {
    pan,
    interactionActive,
    toolMode,
    setToolMode,
    selectedNodeIds,
    setSelectedNodeIds,
    actionsHiddenNodeId,
    selectedId,
    setSelectedId,
    selectionBox,
    alignmentGuides,
    onSurfacePointerDown: handleSurfacePointerDown,
    onSurfacePointerMove: handleSurfacePointerMove,
    stopSurfaceInteraction,
    startNodeDrag,
    moveNode,
    stopNodeDrag,
    consumeSuppressedNodeClick,
  } = useCanvasPointerInteractions({
    viewport,
    setViewport,
    nodes,
    nodesRef,
    edgesRef,
    replaceNodes,
    connection,
    setConnection,
    screenToWorld,
    lastPointer,
    closeContextMenu: () => setContextMenu(undefined),
    clearEdgeSelection: () => setSelectedEdgeId(undefined),
    closeAssets: () => setAssetsOpen(false),
    enqueueSave,
    recordHistory,
    clearAutoSave: () => {
      if (autoSave.current) clearTimeout(autoSave.current);
    },
    showGenerateEditor: (nodeId) => {
      setMediaEditorTab("generate");
      setInspectedNodeId(nodeId);
    },
  });
  const { getInsertionAnchor, resolveNodePosition, revealNodes, arrangeNodes } =
    useCanvasSpatialActions({
      surface,
      viewport,
      setViewport,
      nodesRef,
      edgesRef,
      commitSnapshot: commitCanvasSnapshot,
      conflictRef,
      interactionActive,
      selectedNodeIds,
      setSaveMessage,
    });
  const { upload, uploadNotice, setUploadNotice, transferProgress } =
    useCanvasUpload({
      projectId,
      prepareCanvas: prepareCanvasForAgent,
      applyServerCanvas,
      uploadPosition,
      getInsertionAnchor,
      resolveNodePosition,
      revealNodes,
      setSelectedId,
      setInspectedNodeId,
      setMediaEditorTab,
    });
  useEffect(() => {
    if (inspectedNodeId && inspectedNodeId !== selectedId)
      setInspectedNodeId(undefined);
  }, [inspectedNodeId, selectedId]);
  const startConnection = useCallback(
    (event: PointerEvent<HTMLElement>, sourceNodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      const point = screenToWorld(event.clientX, event.clientY);
      setConnection({ sourceNodeId, ...point });
      setSelectedEdgeId(undefined);
    },
    [screenToWorld],
  );
  const finishConnection = useCallback(
    (event: PointerEvent<HTMLElement>, targetNodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      if (connection && canConnect(connection.sourceNodeId, targetNodeId))
        addEdge(connection.sourceNodeId, targetNodeId);
      setConnection(undefined);
    },
    [addEdge, canConnect, connection],
  );
  const createNode = useCallback(
    (kind: NodeKind, position?: { x: number; y: number }) => {
      let placed;
      try {
        placed = resolveNodePosition(kind, position);
      } catch (error) {
        setSaveMessage(error instanceof Error ? error.message : "无法添加节点");
        return;
      }
      const count =
        nodesRef.current.filter((node) => node.kind === kind).length + 1;
      const base = {
        id: nextNodeId(kind),
        kind,
        title: `${nodeLabel(kind)}${count}`,
        position: placed,
      };
      const node = (
        kind === "text" ? { ...base, text: "" } : base
      ) as VisualCanvasNode;
      commitCanvasSnapshot([...nodesRef.current, node], edgesRef.current);
      revealNodes([node]);
      setSelectedId(node.id);
      if (kind !== "text") setInspectedNodeId(node.id);
      setAssetsOpen(false);
      setContextMenu(undefined);
    },
    [
      nodesRef,
      edgesRef,
      commitCanvasSnapshot,
      resolveNodePosition,
      revealNodes,
      setSaveMessage,
      setSelectedId,
    ],
  );
  const createMediaNodeFromAsset = useCallback(
    (
      asset: {
        id: string;
        media_kind: "image" | "video" | "audio";
        display_name: string;
      },
      position: { x: number; y: number },
    ) => {
      const node = {
        id: nextNodeId(asset.media_kind),
        kind: asset.media_kind,
        title: asset.display_name,
        position: resolveNodePosition(asset.media_kind, position),
        asset_id: asset.id,
      } as VisualCanvasNode;
      commitCanvasSnapshot([...nodesRef.current, node], edgesRef.current);
      revealNodes([node]);
      setSelectedId(node.id);
      setInspectedNodeId(node.id);
      setMediaEditorTab("content");
      setContextMenu(undefined);
      return node;
    },
    [
      commitCanvasSnapshot,
      nodesRef,
      edgesRef,
      resolveNodePosition,
      revealNodes,
      setSelectedId,
    ],
  );
  const { onAssetDragOver, onAssetDrop } = useCanvasAssetDrop({
    projectId,
    screenToWorld,
    createMediaNodeFromAsset,
    setUploadNotice,
  });
  const removeNodes = useCallback(
    (ids: string[]) => {
      const removing = new Set(ids);
      if (
        edgesRef.current.some(
          (edge) =>
            removing.has(edge.source_node_id) &&
            !removing.has(edge.target_node_id),
        )
      ) {
        setSaveMessage("请先解除下游输入引用，再删除节点。");
        return;
      }
      const removedEdgeIds = edgesRef.current
        .filter(
          (edge) =>
            removing.has(edge.source_node_id) ||
            removing.has(edge.target_node_id),
        )
        .map((edge) => edge.id);
      const nextEdges = edgesRef.current.filter(
        (edge) =>
          !removing.has(edge.source_node_id) &&
          !removing.has(edge.target_node_id),
      );
      const cleanedNodes = removeDisconnectedEdgeReferences(
        nodesRef.current,
        edgesRef.current,
        removedEdgeIds,
      );
      const nextNodes = cleanedNodes.filter((node) => !removing.has(node.id));
      commitCanvasSnapshot(nextNodes, nextEdges);
      setSelectedNodeIds((current) =>
        current.filter((id) => !removing.has(id)),
      );
      setInspectedNodeId((current) =>
        current && removing.has(current) ? undefined : current,
      );
      setSelectedEdgeId(undefined);
    },
    [
      edgesRef,
      nodesRef,
      commitCanvasSnapshot,
      setSelectedNodeIds,
      setSaveMessage,
    ],
  );
  const removeNode = useCallback(
    (id: string) => removeNodes([id]),
    [removeNodes],
  );
  const addDerivedImageNode = useCallback(
    async (sourceNodeId: string, asset: ManagedFile) => {
      if (conflictRef.current)
        throw new Error("画布存在保存冲突，请先选择要使用的版本");
      const node = derivedImageNode(nodesRef.current, sourceNodeId, asset);
      const exists = nodesRef.current.some((item) => item.id === node.id);
      if (autoSave.current) {
        clearTimeout(autoSave.current);
        autoSave.current = undefined;
      }
      if (!exists)
        recordHistory({ nodes: nodesRef.current, edges: edgesRef.current });
      const next = exists ? nodesRef.current : [...nodesRef.current, node];
      nodesRef.current = next;
      setNodes(next);
      setSelectedId(node.id);
      setSelectedEdgeId(undefined);
      setAssetsOpen(false);
      enqueueSave(next);
      revealNodes([node]);
      void invalidateFileScope(client, projectId);
      await prepareCanvasForAgent();
    },
    [
      autoSave,
      client,
      conflictRef,
      enqueueSave,
      edgesRef,
      nodesRef,
      recordHistory,
      prepareCanvasForAgent,
      projectId,
      setNodes,
      setSelectedId,
      revealNodes,
    ],
  );
  const {
    canPaste,
    clipboardNotice,
    copyNodes,
    copySelected,
    pasteNodes,
    resetPasteOffset,
  } = useCanvasClipboard({
    projectId,
    nodesRef,
    edgesRef,
    conflictRef,
    selectedNodeIds,
    getPastePosition: () => {
      const pointer = lastPointerClient.current;
      if (pointer) return screenToWorld(pointer.x, pointer.y);
      const bounds = surface.current?.getBoundingClientRect();
      return screenToWorld(
        (bounds?.left ?? 0) + (bounds?.width ?? 0) / 2,
        (bounds?.top ?? 0) + (bounds?.height ?? 0) / 2,
      );
    },
    commitSnapshot: commitCanvasSnapshot,
    selectPasted: (ids) => {
      setSelectedNodeIds(ids);
      setSelectedEdgeId(undefined);
      setInspectedNodeId(undefined);
    },
    closeContextMenu: () => setContextMenu(undefined),
    revealNodes,
  });
  const rememberPointer = (clientX: number, clientY: number) => {
    const previous = lastPointerClient.current;
    if (previous?.x !== clientX || previous?.y !== clientY) resetPasteOffset();
    lastPointerClient.current = { x: clientX, y: clientY };
  };
  const onSurfacePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    rememberPointer(event.clientX, event.clientY);
    handleSurfacePointerDown(event);
    if (event.defaultPrevented) surface.current?.focus({ preventScroll: true });
  };
  const onSurfacePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    rememberPointer(event.clientX, event.clientY);
    handleSurfacePointerMove(event);
  };
  const fitView = useCallback(
    (expandedMediaId?: string) => {
      const bounds = surface.current?.getBoundingClientRect();
      if (!bounds || !nodesRef.current.length) {
        setViewport(DEFAULT_VIEWPORT);
        return;
      }
      const panel = surface.current?.parentElement?.querySelector<HTMLElement>(
        ".canvas-node-inspector:not(.is-embedded), .canvas-assets-drawer",
      );
      const panelBounds = panel?.getBoundingClientRect();
      setViewport(
        fitCanvasViewport(
          nodesRef.current,
          expandedMediaId ?? selectedId,
          bounds,
          panelBounds,
        ),
      );
      setContextMenu(undefined);
    },
    [nodesRef, selectedId],
  );
  const nudgeSelected = useCallback(
    (x: number, y: number) => {
      const selected = new Set(selectedNodeIds);
      replaceNodes((current) =>
        current.map((node) =>
          selected.has(node.id)
            ? ({
                ...node,
                position: {
                  x: node.position.x + x,
                  y: node.position.y + y,
                },
              } as VisualCanvasNode)
            : node,
        ),
      );
    },
    [replaceNodes, selectedNodeIds],
  );

  useCanvasKeyboardShortcuts({
    selectedNodeIds,
    selectedEdgeId,
    clearContextMenu: () => setContextMenu(undefined),
    clearNodeSelection: () => setSelectedId(undefined),
    clearEdgeSelection: () => setSelectedEdgeId(undefined),
    selectAllNodes: () =>
      setSelectedNodeIds(nodesRef.current.map((node) => node.id)),
    copySelected,
    pasteAtPointer: () => pasteNodes(),
    removeNodes,
    removeEdge,
    setToolMode,
    fitView,
    zoomIn: () => setZoom(viewport.zoom + 0.1),
    zoomOut: () => setZoom(viewport.zoom - 0.1),
    resetZoom,
    nudgeSelected,
    undo,
    redo,
  });

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY);
    const width = 176;
    const height = 350;
    setContextMenu({
      left: Math.max(
        8,
        Math.min(event.clientX - bounds.left + 8, bounds.width - width - 8),
      ),
      top: Math.max(
        8,
        Math.min(event.clientY - bounds.top + 8, bounds.height - height - 8),
      ),
      worldX: world.x,
      worldY: world.y,
    });
    lastPointer.current = world;
    rememberPointer(event.clientX, event.clientY);
  };
  const selectedNode = nodes.find((node) => node.id === selectedId);

  return {
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
    canArrange:
      nodes.length >= 2 &&
      !conflict &&
      !interactionActive &&
      !connection &&
      !upload.isPending,
    canArrangeSelected:
      selectedNodeIds.length >= 2 &&
      !conflict &&
      !interactionActive &&
      !connection &&
      !upload.isPending,
    toolMode,
    setToolMode,
    revisionRef,
    nodesRef,
    edgesRef,
    conflictRef,
    saveFailureRef,
    autoSave,
    canPaste,
    clipboardNotice,
    copyNodes,
    uploadPosition,
    viewport,
    setViewport,
    nodes,
    setNodes,
    edges,
    setEdges,
    selectedEdgeId,
    setSelectedEdgeId,
    connection,
    setConnection,
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
    setSaveMessage,
    conflict,
    setConflict,
    projectQuery,
    canvasQuery,
    canvasReady,
    enqueueSave,
    recordHistory,
    clearHistory,
    undo,
    redo,
    prepareCanvasForAgent,
    applyServerCanvas,
    replaceNodes,
    replaceEdges,
    addEdge,
    removeEdge,
    canConnect,
    startConnection,
    finishConnection,
    patchNode,
    linkGenerationTask,
    renameMutation,
    upload,
    uploadNotice,
    transferProgress,
    setZoom,
    resetZoom,
    screenToWorld,
    createNode,
    createMediaNodeFromAsset,
    onAssetDragOver,
    onAssetDrop,
    addDerivedImageNode,
    addCapturedFrameNode: addDerivedImageNode,
    removeNode,
    copySelected,
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
    selectedNode,
  };
}
