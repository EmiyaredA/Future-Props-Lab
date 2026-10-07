import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { VisualCanvasEdge, VisualCanvasNode } from "../api";
import { clampZoom, NODE_SIZE, type NodeKind, type Viewport } from "./geometry";
import {
  canvasBounds,
  placeNode,
  projectInsertionAnchor,
  type CanvasPoint,
} from "./canvasPlacement";
import { arrangeCanvasNodes, type CanvasLayoutMode } from "./canvasLayout";
import {
  revealCanvasBounds,
  visibleCanvasArea,
  worldVisibleArea,
} from "./canvasVisibleArea";

export function useCanvasSpatialActions({
  surface,
  viewport,
  setViewport,
  nodesRef,
  edgesRef,
  commitSnapshot,
  conflictRef,
  interactionActive,
  selectedNodeIds,
  setSaveMessage,
}: {
  surface: RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  nodesRef: RefObject<VisualCanvasNode[]>;
  edgesRef: RefObject<VisualCanvasEdge[]>;
  commitSnapshot: (
    nodes: VisualCanvasNode[],
    edges: VisualCanvasEdge[],
  ) => void;
  conflictRef: RefObject<boolean>;
  interactionActive: boolean;
  selectedNodeIds: string[];
  setSaveMessage: (message: string) => void;
}) {
  const getArea = useCallback(() => {
    const element = surface.current;
    const bounds = element?.getBoundingClientRect();
    if (!element || !bounds?.width || !bounds.height) return undefined;
    const overlays = [
      ...element.parentElement!.querySelectorAll<HTMLElement>(
        ".visual-canvas-topbar, .canvas-tool-dock, .canvas-controls, .canvas-selection-actions, .canvas-assets-drawer, .project-assistant-panel.is-open",
      ),
    ].map((overlay) => overlay.getBoundingClientRect());
    return visibleCanvasArea(bounds, overlays);
  }, [surface]);
  const getInsertionAnchor = useCallback(() => {
    const area = getArea();
    if (!area) return projectInsertionAnchor(nodesRef.current);
    const world = worldVisibleArea(area, viewport);
    return { x: world.x + world.width / 2, y: world.y + world.height / 2 };
  }, [getArea, nodesRef, viewport]);
  const resolveNodePosition = useCallback(
    (kind: NodeKind, anchor?: CanvasPoint) => {
      const preferred = anchor ?? getInsertionAnchor();
      const area = getArea();
      // Center toolbar additions on the visible area; explicit coordinates remain top-left anchors.
      return placeNode(
        nodesRef.current,
        kind,
        anchor || !surface.current
          ? preferred
          : {
              x: preferred.x - NODE_SIZE[kind].width / 2,
              y: preferred.y - NODE_SIZE[kind].height / 2,
            },
        !anchor && area ? worldVisibleArea(area, viewport) : undefined,
      );
    },
    [getArea, getInsertionAnchor, nodesRef, surface, viewport],
  );
  const revealNodes = useCallback(
    (added: VisualCanvasNode[]) => {
      const area = getArea();
      if (!area || !added.length) return;
      setViewport((current) =>
        revealCanvasBounds(canvasBounds(added), area, current),
      );
    },
    [getArea, setViewport],
  );
  const fitNodes = useCallback(
    (targets: VisualCanvasNode[]) => {
      const area = getArea();
      if (!area || !targets.length) return;
      const bounds = canvasBounds(targets);
      const zoom = clampZoom(
        Math.min(
          1.4,
          Math.max(1, area.width - 80) / Math.max(1, bounds.width),
          Math.max(1, area.height - 80) / Math.max(1, bounds.height),
        ),
      );
      setViewport({
        zoom,
        x: area.x + area.width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: area.y + area.height / 2 - (bounds.y + bounds.height / 2) * zoom,
      });
    },
    [getArea, setViewport],
  );
  const arrangeNodes = useCallback(
    (mode: CanvasLayoutMode, selected = false) => {
      if (conflictRef.current || interactionActive) return;
      try {
        const current = nodesRef.current;
        const next = arrangeCanvasNodes(
          current,
          edgesRef.current,
          mode,
          selected ? selectedNodeIds : undefined,
        );
        if (next === current) return;
        commitSnapshot(next, edgesRef.current);
        fitNodes(
          selected
            ? next.filter((node) => selectedNodeIds.includes(node.id))
            : next,
        );
      } catch (error) {
        setSaveMessage(
          error instanceof Error ? error.message : "整理失败，请重试",
        );
      }
    },
    [
      commitSnapshot,
      conflictRef,
      edgesRef,
      fitNodes,
      interactionActive,
      nodesRef,
      selectedNodeIds,
      setSaveMessage,
    ],
  );
  return { getInsertionAnchor, resolveNodePosition, revealNodes, arrangeNodes };
}
