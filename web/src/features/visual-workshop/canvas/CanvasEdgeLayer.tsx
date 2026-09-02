import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";
import { NODE_SIZE } from "@features/visual-workshop/canvas/geometry";

type ConnectionPreview = {
  sourceNodeId: string;
  x: number;
  y: number;
};

function connectionPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
) {
  const bend = Math.max(72, Math.abs(target.x - source.x) * 0.45);
  return `M ${source.x} ${source.y} C ${source.x + bend} ${source.y}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`;
}

export function CanvasEdgeLayer({
  nodes,
  edges,
  selectedEdgeId,
  connection,
  onSelectEdge,
  onRemoveEdge,
}: {
  nodes: VisualCanvasNode[];
  edges: VisualCanvasEdge[];
  selectedEdgeId: string | undefined;
  connection: ConnectionPreview | undefined;
  onSelectEdge: (edgeId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
}) {
  return (
    <svg className="canvas-edge-layer" aria-label="节点连线">
      {edges.map((edge) => {
        const source = nodes.find((node) => node.id === edge.source_node_id);
        const target = nodes.find((node) => node.id === edge.target_node_id);
        if (!source || !target) return null;
        const sourceSize = NODE_SIZE[source.kind];
        const targetSize = NODE_SIZE[target.kind];
        const path = connectionPath(
          {
            x: source.position.x + sourceSize.width,
            y: source.position.y + sourceSize.height / 2,
          },
          {
            x: target.position.x,
            y: target.position.y + targetSize.height / 2,
          },
        );
        const edgeLabel = `连线：${source.title} → ${target.title}`;
        return (
          <g key={edge.id}>
            <path
              className="hit-area"
              d={path}
              role="button"
              tabIndex={0}
              aria-label={edgeLabel}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.focus();
                onSelectEdge(edge.id);
              }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectEdge(edge.id);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemoveEdge(edge.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectEdge(edge.id);
                  return;
                }
                if (event.key !== "Delete" && event.key !== "Backspace") return;
                event.preventDefault();
                event.stopPropagation();
                onRemoveEdge(edge.id);
              }}
            />
            <path
              className={edge.id === selectedEdgeId ? "selected" : ""}
              d={path}
              aria-hidden="true"
            />
          </g>
        );
      })}
      {connection
        ? (() => {
            const source = nodes.find(
              (node) => node.id === connection.sourceNodeId,
            );
            if (!source) return null;
            const size = NODE_SIZE[source.kind];
            return (
              <path
                className="preview"
                d={connectionPath(
                  {
                    x: source.position.x + size.width,
                    y: source.position.y + size.height / 2,
                  },
                  { x: connection.x, y: connection.y },
                )}
              />
            );
          })()
        : null}
    </svg>
  );
}
