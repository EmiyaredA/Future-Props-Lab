import type { VisualCanvasGroup } from "../api";
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
  groupsRef,
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
  groupsRef?: RefObject<VisualCanvasGroup[]>;
  setSaveMessage: (message: string) => void;
}) {
  const getArea = useCallback(() => {
    const element = surface.current;
    const bounds = element?.getBoundingClientRect();
    if (!element || !bounds?.width || !bounds.height) return undefined;
    const overlays = [
      ...element.parentElement!.querySelectorAll<HTMLElement>(
        ".visual-canvas-topbar, .canvas-tool-dock, .canvas-controls, .canvas-selection-actions, .canvas-assets-drawer",
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
    (added: VisualCanvasNode[], options?: { includeEditor?: boolean }) => {
      const area = getArea();
      const element = surface.current;
      if (!area || !added.length) return;
      setViewport((current) => {
        let bounds = canvasBounds(added);
        if (options?.includeEditor && element) {
          const surfaceBounds = element.getBoundingClientRect();
          const ids = new Set(added.map(({ id }) => id));
          const cards =
            element.parentElement?.querySelectorAll<HTMLElement>(
              "[data-node-id]",
            ) ?? [];
          for (const card of cards) {
            if (!ids.has(card.dataset.nodeId ?? "")) continue;
            for (const overlay of card.querySelectorAll<HTMLElement>(
              ".canvas-node-inspector, .canvas-media-node-actions",
            )) {
              if (getComputedStyle(overlay).position === "fixed") continue;
              const box = overlay.getBoundingClientRect();
              if (!box.width || !box.height) continue;
              const x =
                (box.left - surfaceBounds.left - current.x) / current.zoom;
              const y =
                (box.top - surfaceBounds.top - current.y) / current.zoom;
              const right = Math.max(
                bounds.x + bounds.width,
                x + box.width / current.zoom,
              );
              const bottom = Math.max(
                bounds.y + bounds.height,
                y + box.height / current.zoom,
              );
              const left = Math.min(bounds.x, x),
                top = Math.min(bounds.y, y);
              bounds = {
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
              };
            }
          }
        }
        return revealCanvasBounds(bounds, area, current);
      });
    },
    [getArea, setViewport, surface],
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
          groupsRef?.current,
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
      groupsRef,
      interactionActive,
      nodesRef,
      selectedNodeIds,
      setSaveMessage,
    ],
  );
  return { getInsertionAnchor, resolveNodePosition, revealNodes, arrangeNodes };
}
