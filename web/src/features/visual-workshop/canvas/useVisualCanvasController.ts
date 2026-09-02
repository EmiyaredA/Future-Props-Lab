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
  uploadManagedFile,
} from "@features/files";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import {
  DEFAULT_VIEWPORT,
  NODE_SIZE,
  clampZoom,
  cloneNode,
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
import { canConnectCanvasNodes } from "@features/visual-workshop/canvas/canvasGraph";
import { fitCanvasViewport } from "@features/visual-workshop/canvas/canvasFit";
import { useCanvasPersistence } from "@features/visual-workshop/canvas/useCanvasPersistence";
import { useCanvasPointerInteractions } from "@features/visual-workshop/canvas/useCanvasPointerInteractions";
import { useCanvasKeyboardShortcuts } from "@features/visual-workshop/canvas/useCanvasKeyboardShortcuts";

type ContextMenuState = {
  left: number;
  top: number;
  worldX: number;
  worldY: number;
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
  onAssets,
}: VisualWorkshopCanvasPageProps) {
  const client = useQueryClient();
  const surface = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const clipboard = useRef<VisualCanvasNode | undefined>(undefined);
  const lastPointer = useRef({ x: 0, y: 0 });
  const uploadPosition = useRef({ x: 0, y: 0 });
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
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assetTab, setAssetTab] = useState<"project" | "library">("project");
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
  const canvasReady = projectQuery.isSuccess && canvasQuery.isSuccess;
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
    prepareCanvasForAgent,
    replaceNodes,
    patchNode,
    replaceEdges,
  } = useCanvasPersistence(projectId, canvasQuery.data);

  useEffect(() => {
    if (projectQuery.data) setTitle(projectQuery.data.title);
  }, [projectQuery.data]);
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
  const removeEdge = useCallback(
    (edgeId: string) => {
      replaceEdges(
        (current) => current.filter((edge) => edge.id !== edgeId),
        true,
      );
      setSelectedEdgeId((current) =>
        current === edgeId ? undefined : current,
      );
    },
    [replaceEdges],
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
      const next = nodesRef.current.map((node) =>
        node.id === nodeId && node.kind !== "text"
          ? ({
              ...node,
              generation_task_id: taskId,
              asset_id: null,
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
      projectId,
      revisionRef,
      setNodes,
      setSaveMessage,
      setSaveState,
    ],
  );

  useEffect(() => {
    if (!canvasReady) return;
    const element = surface.current;
    if (!element) return;
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
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("gesturestart", handleGestureStart);
      element.removeEventListener("gesturechange", handleGestureChange);
      element.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [canvasReady]);

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
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const created = [];
      for (const file of files)
        created.push(await uploadManagedFile(file, projectId));
      return created;
    },
    onSuccess: (files) => {
      const media = files.filter((file) =>
        ["image", "video", "audio"].includes(file.media_kind),
      );
      if (!media.length) return;
      replaceNodes(
        (current) => [
          ...current,
          ...media.map(
            (file, index) =>
              ({
                id: nextNodeId(file.media_kind as NodeKind),
                kind: file.media_kind,
                title: file.display_name,
                position: {
                  x: uploadPosition.current.x + index * 28,
                  y: uploadPosition.current.y + index * 28,
                },
                asset_id: file.id,
              }) as VisualCanvasNode,
          ),
        ],
        true,
      );
      void invalidateFileScope(client, projectId);
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
    toolMode,
    setToolMode,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedId,
    setSelectedId,
    selectionBox,
    alignmentGuides,
    onSurfacePointerDown,
    onSurfacePointerMove,
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
    replaceNodes,
    connection,
    setConnection,
    screenToWorld,
    lastPointer,
    closeContextMenu: () => setContextMenu(undefined),
    clearEdgeSelection: () => setSelectedEdgeId(undefined),
    closeAssets: () => setAssetsOpen(false),
    enqueueSave,
    clearAutoSave: () => {
      if (autoSave.current) clearTimeout(autoSave.current);
    },
    showGenerateEditor: (nodeId) => {
      setMediaEditorTab("generate");
      setInspectedNodeId(nodeId);
    },
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
    (kind: NodeKind, position: { x: number; y: number }) => {
      const count =
        nodesRef.current.filter((node) => node.kind === kind).length + 1;
      const base = {
        id: nextNodeId(kind),
        kind,
        title: `${nodeLabel(kind)}${count}`,
        position,
      };
      const node = (
        kind === "text" ? { ...base, text: "" } : base
      ) as VisualCanvasNode;
      replaceNodes((current) => [...current, node], true);
      setSelectedId(node.id);
      if (kind !== "text") setInspectedNodeId(node.id);
      setAssetsOpen(false);
      setContextMenu(undefined);
    },
    [nodesRef, replaceNodes, setSelectedId],
  );
  const removeNodes = useCallback(
    (ids: string[]) => {
      const removing = new Set(ids);
      const nextEdges = edgesRef.current.filter(
        (edge) =>
          !removing.has(edge.source_node_id) &&
          !removing.has(edge.target_node_id),
      );
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
      replaceNodes(
        (current) => current.filter((node) => !removing.has(node.id)),
        true,
      );
      setSelectedNodeIds((current) =>
        current.filter((id) => !removing.has(id)),
      );
      setInspectedNodeId((current) =>
        current && removing.has(current) ? undefined : current,
      );
      setSelectedEdgeId(undefined);
    },
    [edgesRef, replaceNodes, setEdges, setSelectedNodeIds],
  );
  const removeNode = useCallback(
    (id: string) => removeNodes([id]),
    [removeNodes],
  );
  const addCapturedFrameNode = useCallback(
    async (sourceNodeId: string, asset: ManagedFile) => {
      const source = nodesRef.current.find((node) => node.id === sourceNodeId);
      if (!source || source.kind !== "video")
        throw new Error("源视频节点已不存在，图片已保留在项目素材中。");
      const node: VisualCanvasNode = {
        id: nextNodeId("image"),
        kind: "image",
        title: asset.display_name,
        position: {
          x: source.position.x + NODE_SIZE.video.width + 48,
          y: source.position.y,
        },
        asset_id: asset.id,
      };
      if (autoSave.current) {
        clearTimeout(autoSave.current);
        autoSave.current = undefined;
      }
      const next = [...nodesRef.current, node];
      nodesRef.current = next;
      setNodes(next);
      setSelectedId(node.id);
      setSelectedEdgeId(undefined);
      setAssetsOpen(false);
      enqueueSave(next);
      void invalidateFileScope(client, projectId);
      await prepareCanvasForAgent();
    },
    [
      autoSave,
      client,
      enqueueSave,
      nodesRef,
      prepareCanvasForAgent,
      projectId,
      setNodes,
      setSelectedId,
    ],
  );
  const copySelected = useCallback(() => {
    const selected = nodesRef.current.find((node) => node.id === selectedId);
    if (selected) clipboard.current = structuredClone(selected);
  }, [nodesRef, selectedId]);
  const pasteNode = useCallback(
    (position?: { x: number; y: number }) => {
      if (!clipboard.current) return;
      const source = clipboard.current;
      const next = cloneNode(
        source,
        position ?? {
          x: source.position.x + 32,
          y: source.position.y + 32,
        },
      );
      replaceNodes((current) => [...current, next], true);
      setSelectedId(next.id);
      setContextMenu(undefined);
    },
    [replaceNodes, setSelectedId],
  );
  const fitView = useCallback(
    (expandedMediaId?: string) => {
      const bounds = surface.current?.getBoundingClientRect();
      if (!bounds || !nodesRef.current.length) {
        setViewport(DEFAULT_VIEWPORT);
        return;
      }
      const panel = surface.current?.parentElement?.querySelector<HTMLElement>(
        ".canvas-node-inspector:not(.is-embedded), .canvas-assets-drawer, .project-assistant-panel.is-open",
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
    pasteAtPointer: () => pasteNode(lastPointer.current),
    removeNodes,
    removeEdge,
    setToolMode,
    fitView,
    zoomIn: () => setZoom(viewport.zoom + 0.1),
    zoomOut: () => setZoom(viewport.zoom - 0.1),
    resetZoom,
    nudgeSelected,
  });

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY);
    const width = 176;
    const height = 246;
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
  };
  const selectedNode = nodes.find((node) => node.id === selectedId);

  return {
    projectId,
    onBack,
    onAssets,
    surface,
    uploadInput,
    pan,
    toolMode,
    setToolMode,
    revisionRef,
    nodesRef,
    edgesRef,
    conflictRef,
    saveFailureRef,
    autoSave,
    clipboard,
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
    setSaveMessage,
    conflict,
    setConflict,
    projectQuery,
    canvasQuery,
    canvasReady,
    enqueueSave,
    prepareCanvasForAgent,
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
    setZoom,
    resetZoom,
    screenToWorld,
    createNode,
    addCapturedFrameNode,
    removeNode,
    copySelected,
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
    selectedNode,
  };
}
