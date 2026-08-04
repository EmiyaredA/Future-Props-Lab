import { PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleQuestionMark,
  Clipboard,
  Copy,
  Focus,
  FolderCog,
  FolderOpen,
  Grid2X2,
  Hand,
  Image,
  List,
  MessageSquareText,
  Minus,
  MousePointer2,
  Music,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Type,
  Upload,
  Video,
  X,
} from "lucide-react";
import { uploadManagedFile } from "@features/files/api";
import { AssetBrowser, type AssetViewMode } from "@features/files/AssetBrowser";
import { CanvasNodeInspector } from "@features/visual-workshop/CanvasNodeInspector";
import { ProjectAssistantPanel } from "@features/visual-workshop/ProjectAssistantPanel";
import {
  getVisualCanvas,
  getVisualWorkshopProject,
  patchVisualWorkshopProject,
  putVisualCanvas,
  type VisualCanvasDocument,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import { ApiError, fetchApiBlob } from "@platform/api/client";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import "@features/visual-workshop/visual-workshop.css";

type Viewport = { x: number; y: number; zoom: number };
type NodeKind = VisualCanvasNode["kind"];
type MediaNode = Exclude<VisualCanvasNode, { kind: "text" }>;
type ContextMenuState = {
  left: number;
  top: number;
  worldX: number;
  worldY: number;
};

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const NODE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  text: { width: 300, height: 180 },
  image: { width: 480, height: 304 },
  video: { width: 480, height: 304 },
  audio: { width: 320, height: 150 },
};
const ATTACHED_EDITOR_SIZE: Partial<
  Record<NodeKind, { width: number; height: number; gap: number }>
> = {
  image: { width: 760, height: 420, gap: 22 },
  video: { width: 760, height: 460, gap: 22 },
};
const NODE_DRAG_BLOCKER_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "video",
  "audio",
  "[contenteditable='true']",
  ".canvas-node-port",
  ".canvas-node-inspector",
  ".project-assistant-panel",
].join(",");

function readViewport(projectId: string): Viewport {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(`fpl_canvas_viewport_${projectId}`) || "null",
    ) as Viewport | null;
    if (
      value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      value.zoom >= 0.25 &&
      value.zoom <= 2
    )
      return value;
  } catch {
    // Corrupt browser preferences fall back to a centered canvas.
  }
  return DEFAULT_VIEWPORT;
}

function clampZoom(value: number) {
  return Math.min(2, Math.max(0.25, value));
}

function nextNodeId(kind: NodeKind) {
  const random =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${kind}-${random}`;
}

function nodeLabel(kind: NodeKind) {
  return { text: "文本", image: "图片", video: "视频", audio: "音频" }[kind];
}

function cloneNode(
  node: VisualCanvasNode,
  position: { x: number; y: number },
): VisualCanvasNode {
  return {
    ...node,
    id: nextNodeId(node.kind),
    title: `${node.title} 副本`,
    position,
  } as VisualCanvasNode;
}

function CanvasMediaPreview({ node }: { node: MediaNode }) {
  const [url, setUrl] = useState("");
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl("");
    setMissing(false);
    if (!node.asset_id) return;
    void fetchApiBlob(`/v1/files/${node.asset_id}/content`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [node.asset_id]);

  if (url && node.kind === "image")
    return <img src={url} alt="" draggable={false} />;
  if (url && node.kind === "video") return <video src={url} controls />;
  if (url && node.kind === "audio") return <audio src={url} controls />;
  const Icon =
    node.kind === "image" ? Image : node.kind === "video" ? Video : Music;
  return (
    <div className={`canvas-media-placeholder${missing ? " is-missing" : ""}`}>
      <Icon aria-hidden />
      <span>
        {missing ? "素材已删除" : `选择或上传${nodeLabel(node.kind)}`}
      </span>
    </div>
  );
}

export function VisualWorkshopCanvasPage({
  projectId,
  onBack,
  onAssets,
}: {
  projectId: string;
  onBack: () => void;
  onAssets: () => void;
}) {
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
    queryKey: ["visual-workshop-project", projectId],
    queryFn: () => getVisualWorkshopProject(projectId),
  });
  const canvasQuery = useQuery({
    queryKey: ["visual-workshop-canvas", projectId],
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

  useEffect(() => {
    if (!canvasReady) return;
    const element = surface.current;
    if (!element) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
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
      client.setQueryData(["visual-workshop-project", projectId], updated);
      void client.invalidateQueries({ queryKey: ["visual-workshop-projects"] });
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
      void client.invalidateQueries({ queryKey: ["canvas-media"] });
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

  return (
    <div className={`visual-canvas${assistantOpen ? " has-assistant" : ""}`}>
      <header className="visual-canvas-topbar">
        <div className="canvas-project-identity">
          <img
            className="canvas-brand-mark"
            src="/brand/visual-workshop-mark-cutout.png"
            alt=""
          />
          <button aria-label="返回项目列表" onClick={onBack}>
            <ArrowLeft aria-hidden />
          </button>
          {editingTitle ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (title.trim()) renameMutation.mutate();
              }}
            >
              <input
                autoFocus
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => {
                  if (title.trim() && title !== projectQuery.data.title)
                    renameMutation.mutate();
                  else setEditingTitle(false);
                }}
              />
            </form>
          ) : (
            <button
              className="canvas-title"
              onClick={() => setEditingTitle(true)}
            >
              {projectQuery.data.title}
              <Pencil aria-hidden />
            </button>
          )}
          <span className={`canvas-save-state ${saveState}`} role="status">
            <Save aria-hidden />
            {saveState === "saving"
              ? "保存中"
              : saveState === "saved"
                ? "已保存"
                : saveState === "conflict"
                  ? "存在冲突"
                  : "保存失败"}
          </span>
        </div>
        <div className="canvas-top-actions">
          <ThemeToggle />
          <button
            className={
              assistantOpen
                ? "active canvas-assistant-trigger"
                : "canvas-assistant-trigger"
            }
            aria-label="对话"
            aria-expanded={assistantOpen}
            onClick={() => setAssistantOpen((value) => !value)}
          >
            <MessageSquareText aria-hidden />
            对话
          </button>
        </div>
      </header>
      <nav className="canvas-tool-dock" aria-label="画布工具">
        <button
          className={assetsOpen ? "active" : ""}
          aria-label="素材库"
          title="素材库"
          onClick={() => {
            setSelectedId(undefined);
            setAssetsOpen((value) => !value);
          }}
        >
          <FolderOpen aria-hidden />
        </button>
        <button aria-label="管理素材" title="管理素材" onClick={onAssets}>
          <FolderCog aria-hidden />
        </button>
      </nav>
      <div
        ref={surface}
        className={`visual-canvas-surface${pan.current ? " is-dragging" : ""}`}
        style={{
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
        }}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onContextMenu={openContextMenu}
      >
        <div
          className="visual-canvas-world"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          {nodes.map((node) => {
            const selected = node.id === selectedId;
            return (
              <article
                className={`canvas-node ${node.kind}${selected ? " selected" : ""}`}
                style={{ left: node.position.x, top: node.position.y }}
                data-node-id={node.id}
                key={node.id}
                onPointerDown={(event) => startNodeDrag(event, node)}
                onPointerMove={moveNode}
                onPointerUp={stopNodeDrag}
                onPointerCancel={stopNodeDrag}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(node.id);
                  setAssetsOpen(false);
                  if (
                    (node.kind === "image" || node.kind === "video") &&
                    selectedId !== node.id
                  ) {
                    setMediaEditorTab("generate");
                  }
                }}
              >
                <header>
                  {node.kind === "image" ? (
                    <Image className="canvas-node-kind-icon" aria-hidden />
                  ) : node.kind === "video" ? (
                    <Video className="canvas-node-kind-icon" aria-hidden />
                  ) : null}
                  {selected ? (
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
                  {!selected &&
                  (node.kind === "image" || node.kind === "video") ? (
                    <Pencil className="canvas-node-title-edit" aria-hidden />
                  ) : null}
                  {selected ? (
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
                    <CanvasMediaPreview node={node} />
                    {node.kind === "image" || node.kind === "video" ? (
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
                          setMediaEditorTab("content");
                          setAssetsOpen(false);
                        }}
                      >
                        <RefreshCw aria-hidden />
                        {node.asset_id ? "替换" : "选择素材"}
                      </button>
                    ) : null}
                  </div>
                )}
                {node.kind === "image" || node.kind === "video" ? (
                  <>
                    <span
                      className="canvas-node-port is-input"
                      aria-hidden="true"
                    >
                      <Plus />
                    </span>
                    <span
                      className="canvas-node-port is-output"
                      aria-hidden="true"
                    >
                      <Plus />
                    </span>
                  </>
                ) : null}
                {selected &&
                (node.kind === "image" || node.kind === "video") ? (
                  <CanvasNodeInspector
                    embedded
                    initialTab={mediaEditorTab}
                    projectId={projectId}
                    node={node}
                    onClose={() => setSelectedId(undefined)}
                    onPatch={(patch, immediate) =>
                      patchNode(node.id, patch, immediate)
                    }
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
          if (files.length) upload.mutate(files);
          event.currentTarget.value = "";
        }}
      />
      {contextMenu ? (
        <div
          className="canvas-context-menu"
          role="menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => {
              uploadPosition.current = {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              };
              setContextMenu(undefined);
              uploadInput.current?.click();
            }}
          >
            <Upload aria-hidden /> 上传
          </button>
          <button
            role="menuitem"
            onClick={() =>
              createNode("text", {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              })
            }
          >
            <Type aria-hidden /> 添加文本节点
          </button>
          <button
            role="menuitem"
            onClick={() =>
              createNode("image", {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              })
            }
          >
            <Image aria-hidden /> 添加图片节点
          </button>
          <button
            role="menuitem"
            onClick={() =>
              createNode("video", {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              })
            }
          >
            <Video aria-hidden /> 添加视频节点
          </button>
          <button
            role="menuitem"
            onClick={() =>
              createNode("audio", {
                x: contextMenu.worldX,
                y: contextMenu.worldY,
              })
            }
          >
            <Music aria-hidden /> 添加音频节点
          </button>
          <button role="menuitem" onClick={() => fitView()}>
            <Focus aria-hidden /> 适应屏幕
          </button>
          <i aria-hidden />
          <button
            role="menuitem"
            disabled={!clipboard.current}
            onClick={() =>
              pasteNode({ x: contextMenu.worldX, y: contextMenu.worldY })
            }
          >
            <Clipboard aria-hidden /> 粘贴
          </button>
        </div>
      ) : null}
      {assetsOpen ? (
        <aside className="canvas-assets-drawer" aria-label="项目素材库">
          <header>
            <div className="canvas-assets-title">
              <strong>素材库</strong>
              <span title="管理本项目素材，或从其他项目导入">
                <CircleQuestionMark aria-hidden />
              </span>
            </div>
            <div className="canvas-assets-header-actions">
              <div
                className="file-view-toggle"
                role="group"
                aria-label="文件视图"
              >
                <button
                  type="button"
                  aria-label="卡片视图"
                  aria-pressed={assetView === "grid"}
                  className={assetView === "grid" ? "active" : ""}
                  onClick={() => setAssetView("grid")}
                >
                  <Grid2X2 aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="列表视图"
                  aria-pressed={assetView === "list"}
                  className={assetView === "list" ? "active" : ""}
                  onClick={() => setAssetView("list")}
                >
                  <List aria-hidden />
                </button>
              </div>
              <button
                className="canvas-assets-close"
                aria-label="关闭素材库"
                onClick={() => setAssetsOpen(false)}
              >
                <X aria-hidden />
              </button>
            </div>
          </header>
          <nav className="canvas-assets-tabs" role="tablist">
            <button
              className={assetTab === "project" ? "active" : ""}
              role="tab"
              aria-selected={assetTab === "project"}
              onClick={() => setAssetTab("project")}
            >
              本项目
            </button>
            <button
              className={assetTab === "library" ? "active" : ""}
              role="tab"
              aria-selected={assetTab === "library"}
              onClick={() => setAssetTab("library")}
            >
              跨项目
            </button>
          </nav>
          {assetTab === "project" ? (
            <AssetBrowser
              compact
              projectId={projectId}
              viewMode={assetView}
              onViewModeChange={setAssetView}
            />
          ) : (
            <AssetBrowser
              compact
              importMode
              projectId={projectId}
              viewMode={assetView}
              onViewModeChange={setAssetView}
              onImported={() => setAssetTab("project")}
            />
          )}
        </aside>
      ) : null}
      {selectedMedia && selectedMedia.kind === "audio" ? (
        <CanvasNodeInspector
          projectId={projectId}
          node={selectedMedia}
          onClose={() => setSelectedId(undefined)}
          onPatch={(patch, immediate) =>
            patchNode(selectedMedia.id, patch, immediate)
          }
        />
      ) : null}
      <ProjectAssistantPanel
        projectId={projectId}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        prepareCanvas={prepareCanvasForAgent}
      />
      {conflict ? (
        <div className="canvas-conflict" role="alert">
          <span>
            <strong>画布存在更新冲突</strong>
            本地草稿仍保留，请选择要使用的版本。
          </span>
          <button
            onClick={() => {
              nodesRef.current = conflict.nodes;
              revisionRef.current = conflict.revision;
              conflictRef.current = false;
              saveFailureRef.current = "";
              setNodes(conflict.nodes);
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
      <div
        className={`canvas-controls${
          assetsOpen || (selectedMedia && selectedMedia.kind === "audio")
            ? " with-assets"
            : ""
        }`}
        aria-label="画布视图控制"
      >
        <div className="canvas-control-mode" aria-hidden>
          <span className="active">
            <MousePointer2 />
          </span>
          <span>
            <Hand />
          </span>
        </div>
        <i aria-hidden />
        <button aria-label="缩小" onClick={() => setZoom(viewport.zoom - 0.1)}>
          <Minus aria-hidden />
        </button>
        <button
          className="canvas-zoom-value"
          onClick={() => setViewport(DEFAULT_VIEWPORT)}
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button aria-label="放大" onClick={() => setZoom(viewport.zoom + 0.1)}>
          <Plus aria-hidden />
        </button>
        <i aria-hidden />
        <button
          aria-label="适配视图"
          title="适配视图"
          onClick={() => fitView()}
        >
          <Focus aria-hidden />
        </button>
      </div>
    </div>
  );
}
