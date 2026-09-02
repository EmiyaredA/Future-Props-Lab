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
        return (
          <path
            key={edge.id}
            className={edge.id === selectedEdgeId ? "selected" : ""}
            d={connectionPath(
              {
                x: source.position.x + sourceSize.width,
                y: source.position.y + sourceSize.height / 2,
              },
              {
                x: target.position.x,
                y: target.position.y + targetSize.height / 2,
              },
            )}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelectEdge(edge.id);
            }}
            onDoubleClick={() => onRemoveEdge(edge.id)}
          />
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
