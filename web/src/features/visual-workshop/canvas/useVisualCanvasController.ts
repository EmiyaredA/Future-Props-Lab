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
  uploadManagedFile,
} from "@features/files";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import {
  ATTACHED_EDITOR_SIZE,
  DEFAULT_VIEWPORT,
  NODE_DRAG_BLOCKER_SELECTOR,
  NODE_SIZE,
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
  putVisualCanvas,
  type VisualCanvasDocument,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import { ApiError } from "@platform/api/client";
import type { VisualWorkshopCanvasPageProps } from "@features/visual-workshop/canvas/visualCanvasTypes";

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
  const revisionRef = useRef(0);
  const nodesRef = useRef<VisualCanvasNode[]>([]);
  const conflictRef = useRef(false);
  const saveFailureRef = useRef("");
  const saveQueue = useRef(Promise.resolve());
  const autoSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clipboard = useRef<VisualCanvasNode | undefined>(undefined);
  const pendingFitNode = useRef<string | undefined>(undefined);
  const lastPointer = useRef({ x: 0, y: 0 });
  const uploadPosition = useRef({ x: 0, y: 0 });
  const [viewport, setViewport] = useState(() => readViewport(projectId));
  const [nodes, setNodes] = useState<VisualCanvasNode[]>([]);
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
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "error" | "conflict"
  >("saved");
  const [saveMessage, setSaveMessage] = useState("");
  const [conflict, setConflict] = useState<VisualCanvasDocument>();
  const projectQuery = useQuery({
    queryKey: visualWorkshopQueryKeys.project(projectId),
    queryFn: () => getVisualWorkshopProject(projectId),
  });
  const canvasQuery = useQuery({
    queryKey: visualWorkshopQueryKeys.canvas(projectId),
    queryFn: () => getVisualCanvas(projectId),
  });
  const canvasReady = projectQuery.isSuccess && canvasQuery.isSuccess;

  useEffect(() => {
    if (projectQuery.data) setTitle(projectQuery.data.title);
  }, [projectQuery.data]);
  useEffect(() => {
    if (!canvasQuery.data) return;
    nodesRef.current = canvasQuery.data.nodes;
    revisionRef.current = canvasQuery.data.revision;
    setNodes(canvasQuery.data.nodes);
  }, [canvasQuery.data]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    window.localStorage.setItem(
      `fpl_canvas_viewport_${projectId}`,
      JSON.stringify(viewport),
    );
  }, [projectId, viewport]);
  useEffect(
    () => () => {
      if (autoSave.current) clearTimeout(autoSave.current);
    },
    [],
  );

  const enqueueSave = useCallback(
    (snapshot: VisualCanvasNode[]) => {
      const copy = structuredClone(snapshot);
      saveQueue.current = saveQueue.current.then(async () => {
        if (conflictRef.current) return;
        setSaveState("saving");
        setSaveMessage("");
        saveFailureRef.current = "";
        try {
          const updated = await putVisualCanvas(
            projectId,
            copy,
            revisionRef.current,
          );
          revisionRef.current = updated.revision;
          setSaveState("saved");
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const current = error.problem.current as
              VisualCanvasDocument | undefined;
            if (current) {
              conflictRef.current = true;
              setConflict(current);
              setSaveState("conflict");
              return;
            }
          }
          setSaveState("error");
          const message =
            error instanceof Error ? error.message : "画布保存失败";
          saveFailureRef.current = message;
          setSaveMessage(message);
        }
      });
    },
    [projectId],
  );

  const prepareCanvasForAgent = useCallback(async () => {
    if (autoSave.current) {
      clearTimeout(autoSave.current);
      autoSave.current = undefined;
      enqueueSave(nodesRef.current);
    }
    await saveQueue.current;
    if (conflictRef.current) {
      throw new Error("画布存在保存冲突，请先选择要使用的版本");
    }
    if (saveFailureRef.current) {
      throw new Error(`画布尚未保存：${saveFailureRef.current}`);
    }
    return revisionRef.current;
  }, [enqueueSave]);

  const replaceNodes = useCallback(
    (
      updater:
        | VisualCanvasNode[]
        | ((current: VisualCanvasNode[]) => VisualCanvasNode[]),
      immediate = false,
    ) => {
      setNodes((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        nodesRef.current = next;
        if (autoSave.current) clearTimeout(autoSave.current);
        if (immediate) enqueueSave(next);
        else
          autoSave.current = setTimeout(
            () => enqueueSave(nodesRef.current),
            650,
          );
        return next;
      });
    },
    [enqueueSave],
  );

  const patchNode = useCallback(
    (nodeId: string, patch: Partial<VisualCanvasNode>, immediate = false) => {
      replaceNodes(
        (current) =>
          current.map((node) =>
            node.id === nodeId
              ? ({ ...node, ...patch } as VisualCanvasNode)
              : node,
          ),
        immediate,
      );
    },
    [replaceNodes],
  );
  const linkGenerationTask = useCallback(
    (nodeId: string, taskId: string) => {
      if (autoSave.current) {
        clearTimeout(autoSave.current);
        autoSave.current = undefined;
      }
      const next = nodesRef.current.map((node) =>
        node.id === nodeId && (node.kind === "image" || node.kind === "video")
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
    [client, projectId],
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
      if (kind === "image" || kind === "video")
        pendingFitNode.current = node.id;
      replaceNodes((current) => [...current, node], true);
      setSelectedId(node.id);
      setAssetsOpen(false);
      setContextMenu(undefined);
    },
    [replaceNodes],
  );
  const removeNode = useCallback(
    (id: string) => {
      replaceNodes((current) => current.filter((node) => node.id !== id), true);
      setSelectedId((current) => (current === id ? undefined : current));
    },
    [replaceNodes],
  );
  const copySelected = useCallback(() => {
    const selected = nodesRef.current.find((node) => node.id === selectedId);
    if (selected) clipboard.current = structuredClone(selected);
  }, [selectedId]);
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
      let availableLeft = 0;
      let availableRight = bounds.width;
      if (panelBounds) {
        if (panelBounds.left < bounds.left + bounds.width / 2) {
          availableLeft = Math.min(
            bounds.width,
            Math.max(0, panelBounds.right - bounds.left + 24),
          );
        } else {
          availableRight = Math.max(
            0,
            Math.min(bounds.width, panelBounds.left - bounds.left - 24),
          );
        }
      }
      const availableWidth = Math.max(1, availableRight - availableLeft);
      const padding = 120;
      const expandedId = expandedMediaId ?? selectedId;
      const attachedEditor = (node: VisualCanvasNode) =>
        node.id === expandedId ? ATTACHED_EDITOR_SIZE[node.kind] : undefined;
      const minX = Math.min(
        ...nodesRef.current.map((node) => {
          const editor = attachedEditor(node);
          return editor
            ? node.position.x -
                Math.max(0, (editor.width - NODE_SIZE[node.kind].width) / 2)
            : node.position.x;
        }),
      );
      const minY = Math.min(...nodesRef.current.map((node) => node.position.y));
      const maxX = Math.max(
        ...nodesRef.current.map((node) => {
          const editor = attachedEditor(node);
          return (
            node.position.x +
            NODE_SIZE[node.kind].width +
            (editor
              ? Math.max(0, (editor.width - NODE_SIZE[node.kind].width) / 2)
              : 0)
          );
        }),
      );
      const maxY = Math.max(
        ...nodesRef.current.map((node) => {
          const editor = attachedEditor(node);
          return (
            node.position.y +
            NODE_SIZE[node.kind].height +
            (editor ? editor.gap + editor.height : 0)
          );
        }),
      );
      const zoom = clampZoom(
        Math.min(
          1.4,
          (availableWidth - padding * 2) / Math.max(1, maxX - minX),
          (bounds.height - padding * 2) / Math.max(1, maxY - minY),
        ),
      );
      setViewport({
        zoom,
        x: availableLeft + availableWidth / 2 - ((minX + maxX) / 2) * zoom,
        y: bounds.height / 2 - ((minY + maxY) / 2) * zoom,
      });
      setContextMenu(undefined);
    },
    [selectedId],
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
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [copySelected, pasteNode, removeNode, selectedId]);

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
    if (
      !completed.moved &&
      (completed.kind === "image" || completed.kind === "video")
    )
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
  const selectedMedia =
    selectedNode?.kind === "text" ? undefined : selectedNode;

  return {
    projectId,
    onBack,
    onAssets,
    surface,
    uploadInput,
    pan,
    revisionRef,
    nodesRef,
    conflictRef,
    saveFailureRef,
    autoSave,
    clipboard,
    uploadPosition,
    viewport,
    setViewport,
    nodes,
    setNodes,
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
    patchNode,
    linkGenerationTask,
    renameMutation,
    upload,
    setZoom,
    screenToWorld,
    createNode,
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
    selectedMedia,
  };
}
