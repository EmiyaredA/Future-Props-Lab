import {
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";
import {
  NODE_DRAG_BLOCKER_SELECTOR,
  NODE_SIZE,
  type Viewport,
} from "@features/visual-workshop/canvas/geometry";

export type CanvasTool = "select" | "pan";

export type CanvasSelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CanvasAlignmentGuide = {
  axis: "horizontal" | "vertical";
  position: number;
  start: number;
  end: number;
};

type WorldRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type ConnectionPreview = {
  sourceNodeId: string;
  x: number;
  y: number;
};

type DragOrigin = {
  id: string;
  x: number;
  y: number;
};

export function exceedsCanvasDragThreshold(deltaX: number, deltaY: number) {
  return Math.hypot(deltaX, deltaY) >= 5;
}

type UseCanvasPointerInteractionsOptions = {
  viewport: Viewport;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  nodes: VisualCanvasNode[];
  nodesRef: RefObject<VisualCanvasNode[]>;
  edgesRef: RefObject<VisualCanvasEdge[]>;
  replaceNodes: (
    updater: (current: VisualCanvasNode[]) => VisualCanvasNode[],
    immediate?: boolean,
    trackHistory?: boolean,
  ) => void;
  connection: ConnectionPreview | undefined;
  setConnection: Dispatch<SetStateAction<ConnectionPreview | undefined>>;
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  lastPointer: RefObject<{ x: number; y: number }>;
  closeContextMenu: () => void;
  clearEdgeSelection: () => void;
  closeAssets: () => void;
  enqueueSave: (nodes: VisualCanvasNode[]) => void;
  recordHistory: (snapshot: {
    nodes: VisualCanvasNode[];
    edges: VisualCanvasEdge[];
  }) => void;
  clearAutoSave: () => void;
  showGenerateEditor: (nodeId: string) => void;
};

function normalizeWorldRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): WorldRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function nodesIntersectingRect(
  nodes: VisualCanvasNode[],
  rect: WorldRect,
) {
  return nodes
    .filter((node) => {
      const size = NODE_SIZE[node.kind];
      return (
        node.position.x <= rect.right &&
        node.position.x + size.width >= rect.left &&
        node.position.y <= rect.bottom &&
        node.position.y + size.height >= rect.top
      );
    })
    .map((node) => node.id);
}

export function moveCanvasNodes(
  nodes: VisualCanvasNode[],
  origins: DragOrigin[],
  deltaX: number,
  deltaY: number,
) {
  const byId = new Map(origins.map((origin) => [origin.id, origin]));
  return nodes.map((node) => {
    const origin = byId.get(node.id);
    return origin
      ? ({
          ...node,
          position: { x: origin.x + deltaX, y: origin.y + deltaY },
        } as VisualCanvasNode)
      : node;
  });
}

export function snapCanvasNodes(
  nodes: VisualCanvasNode[],
  origins: DragOrigin[],
  deltaX: number,
  deltaY: number,
  zoom: number,
) {
  const movingIds = new Set(origins.map((origin) => origin.id));
  const movingNodes = nodes.filter((node) => movingIds.has(node.id));
  const stationaryNodes = nodes.filter((node) => !movingIds.has(node.id));
  const threshold = 6 / zoom;
  let bestX:
    | { difference: number; moving: VisualCanvasNode; target: VisualCanvasNode }
    | undefined;
  let bestY:
    | { difference: number; moving: VisualCanvasNode; target: VisualCanvasNode }
    | undefined;
  const originById = new Map(origins.map((origin) => [origin.id, origin]));

  for (const moving of movingNodes) {
    const origin = originById.get(moving.id);
    if (!origin) continue;
    const movingSize = NODE_SIZE[moving.kind];
    const movingX = origin.x + deltaX;
    const movingY = origin.y + deltaY;
    const movingXs = [
      movingX,
      movingX + movingSize.width / 2,
      movingX + movingSize.width,
    ];
    const movingYs = [
      movingY,
      movingY + movingSize.height / 2,
      movingY + movingSize.height,
    ];
    for (const target of stationaryNodes) {
      const targetSize = NODE_SIZE[target.kind];
      const targetXs = [
        target.position.x,
        target.position.x + targetSize.width / 2,
        target.position.x + targetSize.width,
      ];
      const targetYs = [
        target.position.y,
        target.position.y + targetSize.height / 2,
        target.position.y + targetSize.height,
      ];
      for (const movingAnchor of movingXs) {
        for (const targetAnchor of targetXs) {
          const difference = targetAnchor - movingAnchor;
          if (
            Math.abs(difference) <= threshold &&
            (!bestX || Math.abs(difference) < Math.abs(bestX.difference))
          )
            bestX = { difference, moving, target };
        }
      }
      for (const movingAnchor of movingYs) {
        for (const targetAnchor of targetYs) {
          const difference = targetAnchor - movingAnchor;
          if (
            Math.abs(difference) <= threshold &&
            (!bestY || Math.abs(difference) < Math.abs(bestY.difference))
          )
            bestY = { difference, moving, target };
        }
      }
    }
  }

  const snappedDeltaX = deltaX + (bestX?.difference ?? 0);
  const snappedDeltaY = deltaY + (bestY?.difference ?? 0);
  const guides: CanvasAlignmentGuide[] = [];
  if (bestX) {
    const origin = originById.get(bestX.moving.id)!;
    const movingSize = NODE_SIZE[bestX.moving.kind];
    const targetSize = NODE_SIZE[bestX.target.kind];
    guides.push({
      axis: "vertical",
      position:
        origin.x +
        snappedDeltaX +
        ([0, movingSize.width / 2, movingSize.width].find((anchor) =>
          [
            bestX.target.position.x,
            bestX.target.position.x + targetSize.width / 2,
            bestX.target.position.x + targetSize.width,
          ].some(
            (targetAnchor) =>
              Math.abs(origin.x + snappedDeltaX + anchor - targetAnchor) < 0.01,
          ),
        ) ?? 0),
      start: Math.min(origin.y + snappedDeltaY, bestX.target.position.y),
      end: Math.max(
        origin.y + snappedDeltaY + movingSize.height,
        bestX.target.position.y + targetSize.height,
      ),
    });
  }
  if (bestY) {
    const origin = originById.get(bestY.moving.id)!;
    const movingSize = NODE_SIZE[bestY.moving.kind];
    const targetSize = NODE_SIZE[bestY.target.kind];
    guides.push({
      axis: "horizontal",
      position:
        origin.y +
        snappedDeltaY +
        ([0, movingSize.height / 2, movingSize.height].find((anchor) =>
          [
            bestY.target.position.y,
            bestY.target.position.y + targetSize.height / 2,
            bestY.target.position.y + targetSize.height,
          ].some(
            (targetAnchor) =>
              Math.abs(origin.y + snappedDeltaY + anchor - targetAnchor) < 0.01,
          ),
        ) ?? 0),
      start: Math.min(origin.x + snappedDeltaX, bestY.target.position.x),
      end: Math.max(
        origin.x + snappedDeltaX + movingSize.width,
        bestY.target.position.x + targetSize.width,
      ),
    });
  }
  return { deltaX: snappedDeltaX, deltaY: snappedDeltaY, guides };
}

export function useCanvasPointerInteractions({
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
  closeContextMenu,
  clearEdgeSelection,
  closeAssets,
  enqueueSave,
  recordHistory,
  clearAutoSave,
  showGenerateEditor,
}: UseCanvasPointerInteractionsOptions) {
  const pan = useRef<
    { x: number; y: number; originX: number; originY: number } | undefined
  >(undefined);
  const marqueeSession = useRef<
    | {
        startClientX: number;
        startClientY: number;
        startWorld: { x: number; y: number };
        initialIds: string[];
      }
    | undefined
  >(undefined);
  const nodeDrag = useRef<
    | {
        id: string;
        kind: VisualCanvasNode["kind"];
        x: number;
        y: number;
        origins: DragOrigin[];
        moved: boolean;
        historyRecorded: boolean;
      }
    | undefined
  >(undefined);
  const suppressNodeClick = useRef<string | undefined>(undefined);
  const toolBeforeSpace = useRef<CanvasTool | undefined>(undefined);
  const [toolMode, setToolMode] = useState<CanvasTool>("select");
  const [interactionActive, setInteractionActive] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [actionsHiddenNodeId, setActionsHiddenNodeId] = useState<string>();
  const [selectionBox, setSelectionBox] = useState<CanvasSelectionBox>();
  const [alignmentGuides, setAlignmentGuides] = useState<
    CanvasAlignmentGuide[]
  >([]);
  const selectedId =
    selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined;

  const setSelectedId = useCallback(
    (value: SetStateAction<string | undefined>) => {
      setSelectedNodeIds((current) => {
        const currentId = current.length === 1 ? current[0] : undefined;
        const next = typeof value === "function" ? value(currentId) : value;
        return next ? [next] : [];
      });
    },
    [],
  );

  useEffect(() => {
    const validIds = new Set(nodes.map((node) => node.id));
    setSelectedNodeIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [nodes]);

  useEffect(() => {
    const isEditing = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(
        target.closest(
          "input, textarea, select, button, [role='menu'], [contenteditable='true']",
        ),
      );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditing(event.target)) return;
      event.preventDefault();
      if (event.repeat || toolBeforeSpace.current) return;
      setToolMode((current) => {
        toolBeforeSpace.current = current;
        return "pan";
      });
    };
    const restoreTool = () => {
      const previous = toolBeforeSpace.current;
      if (!previous) return;
      toolBeforeSpace.current = undefined;
      setToolMode(previous);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      restoreTool();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", restoreTool);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", restoreTool);
    };
  }, []);

  const onSurfacePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const isBackground = event.target === event.currentTarget;
    const shouldPan = event.button === 1 || toolMode === "pan";
    if (event.button !== 0 && event.button !== 1) return;
    if (!shouldPan && !isBackground) return;
    if (
      shouldPan &&
      event.target instanceof Element &&
      event.target.closest(NODE_DRAG_BLOCKER_SELECTOR)
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteractionActive(true);
    setActionsHiddenNodeId(undefined);
    closeContextMenu();
    if (shouldPan) {
      pan.current = {
        x: event.clientX,
        y: event.clientY,
        originX: viewport.x,
        originY: viewport.y,
      };
      return;
    }
    clearEdgeSelection();
    const bounds = event.currentTarget.getBoundingClientRect();
    marqueeSession.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorld: screenToWorld(event.clientX, event.clientY),
      initialIds: event.shiftKey ? selectedNodeIds : [],
    };
    if (!event.shiftKey) setSelectedNodeIds([]);
    setSelectionBox({
      left: event.clientX - bounds.left,
      top: event.clientY - bounds.top,
      width: 0,
      height: 0,
    });
  };

  const onSurfacePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    lastPointer.current = screenToWorld(event.clientX, event.clientY);
    if (connection) {
      setConnection((current) =>
        current ? { ...current, ...lastPointer.current } : current,
      );
      return;
    }
    const activeMarquee = marqueeSession.current;
    if (activeMarquee) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const startX = activeMarquee.startClientX - bounds.left;
      const startY = activeMarquee.startClientY - bounds.top;
      const currentX = event.clientX - bounds.left;
      const currentY = event.clientY - bounds.top;
      setSelectionBox({
        left: Math.min(startX, currentX),
        top: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      });
      const hits = nodesIntersectingRect(
        nodesRef.current,
        normalizeWorldRect(activeMarquee.startWorld, lastPointer.current),
      );
      setSelectedNodeIds([...new Set([...activeMarquee.initialIds, ...hits])]);
      return;
    }
    const activePan = pan.current;
    if (!activePan) return;
    const nextX = activePan.originX + event.clientX - activePan.x;
    const nextY = activePan.originY + event.clientY - activePan.y;
    setViewport((current) => ({ ...current, x: nextX, y: nextY }));
  };

  const stopSurfaceInteraction = () => {
    setInteractionActive(false);
    pan.current = undefined;
    marqueeSession.current = undefined;
    setSelectionBox(undefined);
    setConnection(undefined);
  };

  const startNodeDrag = (
    event: PointerEvent<HTMLElement>,
    node: VisualCanvasNode,
  ) => {
    const target = event.target;
    if (
      toolMode !== "select" ||
      event.button !== 0 ||
      (target instanceof Element && target.closest(NODE_DRAG_BLOCKER_SELECTOR))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteractionActive(true);
    setActionsHiddenNodeId(undefined);
    const ids = selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id];
    if (!selectedNodeIds.includes(node.id)) setSelectedNodeIds(ids);
    clearEdgeSelection();
    closeAssets();
    closeContextMenu();
    nodeDrag.current = {
      id: node.id,
      kind: node.kind,
      x: event.clientX,
      y: event.clientY,
      origins: nodesRef.current
        .filter((item) => ids.includes(item.id))
        .map((item) => ({
          id: item.id,
          x: item.position.x,
          y: item.position.y,
        })),
      moved: false,
      historyRecorded: false,
    };
  };

  const moveNode = (event: PointerEvent<HTMLElement>) => {
    const current = nodeDrag.current;
    if (!current) return;
    const screenDeltaX = event.clientX - current.x;
    const screenDeltaY = event.clientY - current.y;
    if (
      !current.moved &&
      !exceedsCanvasDragThreshold(screenDeltaX, screenDeltaY)
    )
      return;
    current.moved = true;
    if (!current.historyRecorded) {
      recordHistory({ nodes: nodesRef.current, edges: edgesRef.current });
      current.historyRecorded = true;
    }
    setActionsHiddenNodeId(current.id);
    const deltaX = screenDeltaX / viewport.zoom;
    const deltaY = screenDeltaY / viewport.zoom;
    const snapped = snapCanvasNodes(
      nodesRef.current,
      current.origins,
      deltaX,
      deltaY,
      viewport.zoom,
    );
    setAlignmentGuides(snapped.guides);
    replaceNodes(
      (items) =>
        moveCanvasNodes(items, current.origins, snapped.deltaX, snapped.deltaY),
      false,
      false,
    );
  };

  const stopNodeDrag = (event: PointerEvent<HTMLElement>) => {
    const completed = nodeDrag.current;
    if (!completed) return;
    nodeDrag.current = undefined;
    setInteractionActive(false);
    setAlignmentGuides([]);
    if (completed.moved) {
      clearAutoSave();
      enqueueSave(nodesRef.current);
      if (event.type === "pointerup") suppressNodeClick.current = completed.id;
    } else if (completed.kind !== "text") {
      showGenerateEditor(completed.id);
    }
  };

  const consumeSuppressedNodeClick = (nodeId: string) => {
    if (suppressNodeClick.current !== nodeId) return false;
    suppressNodeClick.current = undefined;
    return true;
  };

  return {
    interactionActive,
    pan,
    toolMode,
    setToolMode,
    selectedNodeIds,
    setSelectedNodeIds,
    actionsHiddenNodeId,
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
  };
}
