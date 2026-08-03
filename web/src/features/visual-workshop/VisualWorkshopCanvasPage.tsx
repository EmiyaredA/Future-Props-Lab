import { PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Clipboard,
  Copy,
  Focus,
  FolderCog,
  FolderOpen,
  Hand,
  Image,
  Maximize,
  Minimize,
  Minus,
  MousePointer2,
  Music,
  Pencil,
  Plus,
  Save,
  Trash2,
  Type,
  Upload,
  Video,
  X,
} from "lucide-react";
import { uploadManagedFile } from "@features/files/api";
import { AssetBrowser } from "@features/files/AssetBrowser";
import { CanvasNodeInspector } from "@features/visual-workshop/CanvasNodeInspector";
import {
  getVisualCanvas,
  getVisualWorkshopProject,
  patchVisualWorkshopProject,
  putVisualCanvas,
  type VisualCanvasDocument,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import { ApiError, fetchApiBlob } from "@platform/api/client";
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
  image: { width: 320, height: 230 },
  video: { width: 340, height: 235 },
  audio: { width: 320, height: 150 },
};

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

  if (url && node.kind === "image") return <img src={url} alt="" />;
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
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const pan = useRef<
    { x: number; y: number; originX: number; originY: number } | undefined
  >(undefined);
  const nodeDrag = useRef<
    | { id: string; x: number; y: number; originX: number; originY: number }
    | undefined
  >(undefined);
  const revisionRef = useRef(0);
  const nodesRef = useRef<VisualCanvasNode[]>([]);
  const conflictRef = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const autoSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clipboard = useRef<VisualCanvasNode | undefined>(undefined);
  const lastPointer = useRef({ x: 0, y: 0 });
  const uploadPosition = useRef({ x: 0, y: 0 });
  const [viewport, setViewport] = useState(() => readViewport(projectId));
  const [nodes, setNodes] = useState<VisualCanvasNode[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [assetTab, setAssetTab] = useState<"project" | "library">("project");
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [immersiveFallback, setImmersiveFallback] = useState(false);
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
          setSaveMessage(
            error instanceof Error ? error.message : "画布保存失败",
          );
        }
      });
    },
    [projectId],
  );

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
  }, []);

  useEffect(() => {
    const sync = () => {
      const active = document.fullscreenElement === root.current;
      setFullscreen(active);
      if (active) setImmersiveFallback(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!immersiveFallback) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImmersiveFallback(false);
    };
    window.addEventListener("keydown", exit);
    return () => window.removeEventListener("keydown", exit);
  }, [immersiveFallback]);

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
  const fitView = useCallback(() => {
    const bounds = surface.current?.getBoundingClientRect();
    if (!bounds || !nodesRef.current.length) {
      setViewport(DEFAULT_VIEWPORT);
      return;
    }
    const padding = 120;
    const minX = Math.min(...nodesRef.current.map((node) => node.position.x));
    const minY = Math.min(...nodesRef.current.map((node) => node.position.y));
    const maxX = Math.max(
      ...nodesRef.current.map(
        (node) => node.position.x + NODE_SIZE[node.kind].width,
      ),
    );
    const maxY = Math.max(
      ...nodesRef.current.map(
        (node) => node.position.y + NODE_SIZE[node.kind].height,
      ),
    );
    const zoom = clampZoom(
      Math.min(
        1.4,
        (bounds.width - padding * 2) / Math.max(1, maxX - minX),
        (bounds.height - padding * 2) / Math.max(1, maxY - minY),
      ),
    );
    setViewport({
      zoom,
      x: bounds.width / 2 - ((minX + maxX) / 2) * zoom,
      y: bounds.height / 2 - ((minY + maxY) / 2) * zoom,
    });
    setContextMenu(undefined);
  }, []);

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
    if (!pan.current) return;
    setViewport((current) => ({
      ...current,
      x: pan.current!.originX + event.clientX - pan.current!.x,
      y: pan.current!.originY + event.clientY - pan.current!.y,
    }));
  };
  const stopPan = () => {
    pan.current = undefined;
  };
  const startNodeDrag = (
    event: PointerEvent<HTMLElement>,
    node: VisualCanvasNode,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(node.id);
    setAssetsOpen(false);
    setContextMenu(undefined);
    nodeDrag.current = {
      id: node.id,
      x: event.clientX,
      y: event.clientY,
      originX: node.position.x,
      originY: node.position.y,
    };
  };
  const moveNode = (event: PointerEvent<HTMLElement>) => {
    if (!nodeDrag.current) return;
    const current = nodeDrag.current;
    patchNode(current.id, {
      position: {
        x: current.originX + (event.clientX - current.x) / viewport.zoom,
        y: current.originY + (event.clientY - current.y) / viewport.zoom,
      },
    });
  };
  const stopNodeDrag = () => {
    if (!nodeDrag.current) return;
    nodeDrag.current = undefined;
    if (autoSave.current) clearTimeout(autoSave.current);
    enqueueSave(nodesRef.current);
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
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (immersiveFallback) {
      setImmersiveFallback(false);
      return;
    }
    try {
      await root.current?.requestFullscreen();
    } catch {
      setImmersiveFallback(true);
    }
  };
  const isFullscreen = fullscreen || immersiveFallback;
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
    <div
      ref={root}
      className={`visual-canvas${immersiveFallback ? " is-immersive" : ""}`}
    >
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
          <button
            aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
            {isFullscreen ? "退出全屏" : "全屏"}
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
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(node.id);
                  setAssetsOpen(false);
                }}
              >
                <header
                  onPointerDown={(event) => startNodeDrag(event, node)}
                  onPointerMove={moveNode}
                  onPointerUp={stopNodeDrag}
                  onPointerCancel={stopNodeDrag}
                >
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
                  </div>
                )}
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
          <button role="menuitem" onClick={fitView}>
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
            <strong>素材库</strong>
            <button
              aria-label="关闭素材库"
              onClick={() => setAssetsOpen(false)}
            >
              <X aria-hidden />
            </button>
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
              文件管理
            </button>
          </nav>
          {assetTab === "project" ? (
            <AssetBrowser compact projectId={projectId} />
          ) : (
            <AssetBrowser
              compact
              importMode
              projectId={projectId}
              onImported={() => setAssetTab("project")}
            />
          )}
        </aside>
      ) : null}
      {selectedMedia ? (
        <CanvasNodeInspector
          projectId={projectId}
          node={selectedMedia}
          onClose={() => setSelectedId(undefined)}
          onPatch={(patch, immediate) =>
            patchNode(selectedMedia.id, patch, immediate)
          }
        />
      ) : null}
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
        className={`canvas-controls${assetsOpen || selectedMedia ? " with-assets" : ""}`}
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
        <button aria-label="适配视图" title="适配视图" onClick={fitView}>
          <Focus aria-hidden />
        </button>
      </div>
    </div>
  );
}
