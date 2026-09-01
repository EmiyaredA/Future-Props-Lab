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
  NODE_DRAG_BLOCKER_SELECTOR,
  clampZoom,
  cloneNode,
  nextNodeId,
  nodeLabel,
  readViewport,
  type NodeKind,
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

type ContextMenuState = {
  left: number;
  top: number;
  worldX: number;
  worldY: number;
};

export function useVisualCanvasController({
  projectId,
  onBack,
  onAssets,
}: VisualWorkshopCanvasPageProps) {
  const client = useQueryClient();
  const surface = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const pan = useRef<
    { x: number; y: number; originX: number; originY: number } | undefined
  >(undefined);
  const nodeDrag = useRef<
    | {
        id: string;
        kind: VisualCanvasNode["kind"];
        x: number;
        y: number;
        originX: number;
        originY: number;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const clipboard = useRef<VisualCanvasNode | undefined>(undefined);
  const pendingFitNode = useRef<string | undefined>(undefined);
  const lastPointer = useRef({ x: 0, y: 0 });
  const uploadPosition = useRef({ x: 0, y: 0 });
  const [viewport, setViewport] = useState(() => readViewport(projectId));
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [connection, setConnection] = useState<{
    sourceNodeId: string;
    x: number;
    y: number;
  }>();
  const [selectedId, setSelectedId] = useState<string>();
  const [mediaEditorTab, setMediaEditorTab] = useState<"content" | "generate">(
    "generate",
  );
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
      if (
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
        const factor = event.ctrlKey
          ? Math.exp(-event.deltaY * 0.01)
          : event.deltaY > 0
            ? 0.9
            : 1.1;
        const zoom = clampZoom(current.zoom * factor);
        const ratio = zoom / current.zoom;
        return {
          zoom,
          x: pointerX - (pointerX - current.x) * ratio,
          y: pointerY - (pointerY - current.y) * ratio,
        };
      });
    };
    const preventGestureZoom = (event: Event) => event.preventDefault();
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("gesturestart", preventGestureZoom, {
      passive: false,
    });
    element.addEventListener("gesturechange", preventGestureZoom, {
      passive: false,
    });
    element.addEventListener("gestureend", preventGestureZoom, {
      passive: false,
    });
    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("gesturestart", preventGestureZoom);
      element.removeEventListener("gesturechange", preventGestureZoom);
      element.removeEventListener("gestureend", preventGestureZoom);
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

  const setZoom = (zoom: number) =>
    setViewport((current) => ({ ...current, zoom: clampZoom(zoom) }));
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
  const startConnection = useCallback(
    (event: PointerEvent<HTMLElement>, sourceNodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      const point = screenToWorld(event.clientX, event.clientY);
      setConnection({ sourceNodeId, ...point });
      setSelectedId(sourceNodeId);
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
      if (kind !== "text") pendingFitNode.current = node.id;
      replaceNodes((current) => [...current, node], true);
      setSelectedId(node.id);
      setAssetsOpen(false);
      setContextMenu(undefined);
    },
    [nodesRef, replaceNodes],
  );
  const removeNode = useCallback(
    (id: string) => {
      const nextEdges = edgesRef.current.filter(
        (edge) => edge.source_node_id !== id && edge.target_node_id !== id,
      );
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
      replaceNodes((current) => current.filter((node) => node.id !== id), true);
      setSelectedId((current) => (current === id ? undefined : current));
      setSelectedEdgeId(undefined);
    },
    [edgesRef, replaceNodes, setEdges],
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
    [replaceNodes],
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

  useEffect(() => {
    const nodeId = pendingFitNode.current;
    if (!nodeId || selectedId !== nodeId) return;
    pendingFitNode.current = undefined;
    requestAnimationFrame(() => fitView(nodeId));
  }, [fitView, nodes, selectedId]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const target = event.target;
      const editing =
        target instanceof Element &&
        target.matches("input, textarea, select, [contenteditable='true']");
      if (event.key === "Escape") {
        setContextMenu(undefined);
        setSelectedId(undefined);
        setSelectedEdgeId(undefined);
        return;
      }
      if (editing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelected();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteNode(lastPointer.current);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        removeNode(selectedId);
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedEdgeId
      ) {
        event.preventDefault();
        removeEdge(selectedEdgeId);
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [
    copySelected,
    pasteNode,
    removeEdge,
    removeNode,
    selectedEdgeId,
    selectedId,
  ]);

  const onSurfacePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(undefined);
    setContextMenu(undefined);
    pan.current = {
      x: event.clientX,
      y: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
  };
  const onSurfacePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    lastPointer.current = screenToWorld(event.clientX, event.clientY);
    if (connection) {
      setConnection((current) =>
        current ? { ...current, ...lastPointer.current } : current,
      );
      return;
    }
    const activePan = pan.current;
    if (!activePan) return;
    const nextX = activePan.originX + event.clientX - activePan.x;
    const nextY = activePan.originY + event.clientY - activePan.y;
    setViewport((current) => ({
      ...current,
      x: nextX,
      y: nextY,
    }));
  };
  const stopPan = () => {
    pan.current = undefined;
    setConnection(undefined);
  };
  const startNodeDrag = (
    event: PointerEvent<HTMLElement>,
    node: VisualCanvasNode,
  ) => {
    const target = event.target;
    if (
      event.button !== 0 ||
      (target instanceof Element && target.closest(NODE_DRAG_BLOCKER_SELECTOR))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(node.id);
    setAssetsOpen(false);
    setContextMenu(undefined);
    nodeDrag.current = {
      id: node.id,
      kind: node.kind,
      x: event.clientX,
      y: event.clientY,
      originX: node.position.x,
      originY: node.position.y,
      moved: false,
    };
  };
  const moveNode = (event: PointerEvent<HTMLElement>) => {
    if (!nodeDrag.current) return;
    const current = nodeDrag.current;
    if (
      Math.abs(event.clientX - current.x) > 3 ||
      Math.abs(event.clientY - current.y) > 3
    )
      current.moved = true;
    patchNode(current.id, {
      position: {
        x: current.originX + (event.clientX - current.x) / viewport.zoom,
        y: current.originY + (event.clientY - current.y) / viewport.zoom,
      },
    });
  };
  const stopNodeDrag = () => {
    if (!nodeDrag.current) return;
    const completed = nodeDrag.current;
    nodeDrag.current = undefined;
    if (autoSave.current) clearTimeout(autoSave.current);
    enqueueSave(nodesRef.current);
    if (!completed.moved && completed.kind !== "text")
      setMediaEditorTab("generate");
  };
  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY);
    const width = 208;
    const height = 322;
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
    mediaEditorTab,
    setMediaEditorTab,
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
    screenToWorld,
    createNode,
    addCapturedFrameNode,
    removeNode,
    copySelected,
    pasteNode,
    fitView,
    onSurfacePointerDown,
    onSurfacePointerMove,
    stopPan,
    startNodeDrag,
    moveNode,
    stopNodeDrag,
    openContextMenu,
    selectedNode,
  };
}
