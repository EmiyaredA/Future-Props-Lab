import type { Slide } from "../types";
import type { Connection } from "./model";
import {
  connectionPoints,
  anchor,
  connectionPorts,
  near,
  type Point,
  type RouteHandle,
} from "./connectionGeometry";
import type { useConnectionDrag } from "./useConnectionDrag";
import "./connection-handles.css";

type DragController = ReturnType<typeof useConnectionDrag>;
const sideNames = { left: "左侧", right: "右侧", top: "顶部", bottom: "底部" };

export function ConnectionHandles({
  slide,
  edge,
  scale,
  drag,
}: {
  slide: Slide;
  edge: Connection;
  scale: number;
  drag: DragController;
}) {
  const points = connectionPoints(slide, edge);
  if (points.length < 2) return null;
  const handles: {
    handle: RouteHandle;
    point: Point;
    label: string;
    cursor?: string;
  }[] = [];
  points.slice(1, -1).forEach((p, i) =>
    handles.push({
      handle: { kind: "corner", index: i + 1 },
      point: p,
      label: `调整连接拐点 ${i + 1}`,
    }),
  );
  points.slice(0, -1).forEach((a, i) => {
    const b = points[i + 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) * scale < 24 && points.length > 2)
      return;
    handles.push({
      handle: { kind: "segment", index: i },
      point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      label: `调整连接线段 ${i + 1}`,
      cursor: near(a.x, b.x)
        ? "ew-resize"
        : near(a.y, b.y)
          ? "ns-resize"
          : "move",
    });
  });
  // Endpoints are last so coincident and zero-length routes remain reconnectable.
  handles.push(
    {
      handle: { kind: "source", index: 0 },
      point: points[0],
      label: "拖动连接起点",
    },
    {
      handle: { kind: "target", index: points.length - 1 },
      point: points[points.length - 1],
      label: "拖动连接终点",
    },
  );
  const ports = drag.endpoint
    ? connectionPorts(slide, edge, drag.endpoint.end)
    : [];
  const ghost = drag.endpoint
    ? points.map((p, i) =>
        i === (drag.endpoint!.end === "source" ? 0 : points.length - 1)
          ? drag.endpoint!.point
          : p,
      )
    : [];
  return (
    <div
      className="presentation-connection-handles"
      data-connection-editor={edge.id}
    >
      {ghost.length > 0 && (
        <svg
          className="presentation-connection-ghost"
          width="100%"
          height="100%"
          aria-hidden="true"
        >
          {slide.elements
            .filter(
              (e) =>
                e.kind !== "line" &&
                e.id !==
                  (drag.endpoint!.end === "source"
                    ? edge.target_id
                    : edge.source_id),
            )
            .map((e) => {
              const outline = [
                anchor(e, "top", 0),
                anchor(e, "top", 1),
                anchor(e, "bottom", 1),
                anchor(e, "bottom", 0),
              ];
              return (
                <polygon
                  key={e.id}
                  points={outline.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={
                    (drag.endpoint!.port?.id === e.id ? 2 : 1) / scale
                  }
                  opacity={drag.endpoint!.port?.id === e.id ? 1 : 0.35}
                />
              );
            })}
          <path
            d={ghost.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2 / scale}
            strokeDasharray={`${5 / scale} ${4 / scale}`}
          />
        </svg>
      )}
      {ports.map((port) => (
        <span
          key={`${port.id}-${port.side}`}
          className="presentation-connection-port"
          style={{
            left: port.point.x,
            top: port.point.y,
            transform: `translate(-50%, -50%) scale(${1 / scale})`,
          }}
          title={`${port.id} ${sideNames[port.side]}`}
          data-port-element={port.id}
          data-port-side={port.side}
        />
      ))}
      {drag.endpoint?.port && (
        <span
          className="presentation-connection-port active"
          style={{
            left: drag.endpoint.port.point.x,
            top: drag.endpoint.port.point.y,
            transform: `translate(-50%, -50%) scale(${1 / scale})`,
          }}
        />
      )}
      {handles.map(({ handle, point, label, cursor }) => (
        <button
          key={`${handle.kind}-${handle.index}`}
          type="button"
          className={`presentation-connection-handle ${handle.kind}`}
          data-connection-handle={handle.kind}
          data-route-index={handle.index}
          aria-label={label}
          title={`${label}；方向键沿边微调，Shift 加速；垂直于边的方向键切换连接点`}
          style={{
            left: point.x,
            top: point.y,
            transform: `translate(-50%, -50%) scale(${1 / scale})`,
            cursor,
          }}
          onPointerDown={(event) => drag.start(event, edge, handle, point)}
          onKeyDown={(event) => drag.key(event, edge, handle, point)}
        />
      ))}
    </div>
  );
}
