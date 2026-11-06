import { describe, it, expect } from "vitest";
import vectors from "../../../tests/fixtures/presentation_connection_routes.json";
import {
  newElement,
  newSlide,
} from "@features/presentation-workshop/templates";
import {
  updateScene,
  type Connection,
} from "@features/presentation-workshop/scene/model";
import {
  anchor,
  checkedWaypoints,
  connectionPoints,
  dragRoute,
  nearestConnectionPort,
  reconnect,
  simplifyRoute,
} from "@features/presentation-workshop/scene/connectionGeometry";
import { validateFragment } from "@features/presentation-workshop/infographics/validation";

function fixture() {
  const s = newSlide();
  s.elements = [
    newElement("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 }),
    newElement("rect", { id: "b", x: 700, y: 300, width: 200, height: 100 }),
  ];
  s.connections = [
    {
      id: "edge",
      arrow: true,
      color: "#365F62",
      label: "",
      layer: 0,
      width: 2,
      source_id: "a",
      target_id: "b",
      source_anchor: "right",
      target_anchor: "left",
      source_offset: 0.5,
      target_offset: 0.5,
      style: "step",
      waypoints: [
        { x: 500, y: 150 },
        { x: 500, y: 350 },
      ],
    },
  ];
  return s;
}
const axial = (points: { x: number; y: number }[]) =>
  points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y);

describe("connection routes", () => {
  it("keeps paths and history unchanged for a stationary handle or unchanged binding", () => {
    const s = fixture(),
      edge = s.connections![0];
    expect(
      dragRoute(s, edge, { kind: "segment", index: 1 }, { x: 500, y: 250 }),
    ).toBe(edge);
    expect(
      reconnect(edge, "target", {
        id: "b",
        side: "left",
        offset: 0.5,
        point: { x: 700, y: 350 },
      }),
    ).toBe(edge);
    const straight = { ...edge, style: "straight" as const };
    expect(connectionPoints(s, straight)).toEqual([
      { x: 300, y: 150 },
      { x: 700, y: 350 },
    ]);
  });
  it.each(vectors)(
    "shares node follow behavior with Python: $name",
    (vector) => {
      const s = fixture();
      s.elements = vector.elements.map((e) => newElement("rect", e));
      s.connections = [vector.edge as Connection];
      const moved = updateScene(s, {
        ...s,
        elements: s.elements.map((e) => ({
          ...e,
          ...vector.changes.find((c) => c.id === e.id),
        })),
      });
      expect(moved.connections![0].waypoints).toEqual(vector.expected);
      expect(s.connections[0]).toEqual(vector.edge);
    },
  );
  it("moves a segment and a corner while retaining both bindings and orthogonal segments", () => {
    const s = fixture(),
      edge = s.connections![0];
    for (const [handle, point] of [
      [
        { kind: "segment", index: 1 },
        { x: 570, y: 250 },
      ],
      [
        { kind: "segment", index: 0 },
        { x: 400, y: 80 },
      ],
      [
        { kind: "corner", index: 1 },
        { x: 540, y: 180 },
      ],
    ] as const) {
      const next = dragRoute(s, edge, handle, point);
      expect(next.source_id).toBe("a");
      expect(next.target_id).toBe("b");
      const points = connectionPoints(s, next);
      expect(points[0]).toEqual({ x: 300, y: 150 });
      expect(points.at(-1)).toEqual({ x: 700, y: 350 });
      expect(axial(points)).toBe(true);
    }
  });
  it("keeps a dragged straight midpoint straight and bound to the same sides", () => {
    const s = fixture(),
      edge = {
        ...s.connections![0],
        style: "straight" as const,
        waypoints: [],
      };
    const next = dragRoute(
      s,
      edge,
      { kind: "segment", index: 0 },
      { x: 500, y: 270 },
    );
    expect(next.style).toBe("straight");
    expect(next.waypoints).toEqual([]);
    expect(next.source_id).toBe("a");
    expect(next.target_id).toBe("b");
    expect(next.source_offset).toBe(0.7);
    expect(next.target_offset).toBe(0.7);
    expect(connectionPoints(s, next)).toEqual([
      { x: 300, y: 170 },
      { x: 700, y: 370 },
    ]);
  });
  it("keeps explicit path changes when nodes also move", () => {
    const s = fixture(),
      points = [{ x: 450, y: 160 }];
    expect(
      updateScene(s, {
        ...s,
        elements: s.elements.map((e) => ({ ...e, x: e.x + 20 })),
        connections: [{ ...s.connections![0], waypoints: points }],
      }).connections![0].waypoints,
    ).toBe(points);
  });
  it("snaps to any position on a grouped panel side, past overlapping content", () => {
    const s = fixture();
    s.elements.push(
      newElement("text", {
        id: "title",
        x: 720,
        y: 310,
        width: 160,
        height: 40,
      }),
      newElement("line", { id: "decoration", x: 701, y: 320 }),
    );
    s.groups = [
      { id: "panel", name: "填充后的页面", element_ids: ["b", "title"] },
    ];
    const port = nearestConnectionPort(
      s,
      s.connections![0],
      "target",
      { x: 702, y: 320 },
      1,
    )!;
    expect(port.id).toBe("b");
    expect(port.side).toBe("left");
    expect(port.offset).toBeCloseTo(0.2);
    const next = reconnect(s.connections![0], "target", port);
    expect(connectionPoints(s, next).at(-1)).toEqual({ x: 700, y: 320 });
    expect(next.target_offset).toBe(0.2);
    expect(
      nearestConnectionPort(s, next, "target", { x: 100, y: 100 }, 1),
    ).toBeNull();
    expect(
      nearestConnectionPort(s, next, "target", { x: 600, y: 20 }, 1),
    ).toBeNull();
  });
  it("uses screen distance and rotated edge projection", () => {
    const s = fixture();
    s.elements[1].rotation = 90;
    const p = anchor(s.elements[1], "left", 0.2);
    const port = nearestConnectionPort(s, s.connections![0], "target", p, 0.5)!;
    expect(port.side).toBe("left");
    expect(port.offset).toBeCloseTo(0.2);
    s.elements[1].rotation = 0;
    expect(
      nearestConnectionPort(
        s,
        s.connections![0],
        "target",
        { x: 720, y: 325 },
        1,
      ),
    ).toBeNull();
    expect(
      nearestConnectionPort(
        s,
        s.connections![0],
        "target",
        { x: 720, y: 325 },
        0.5,
      )?.offset,
    ).toBe(0.25);
  });
  it("compacts degenerate routes, preserves U turns and rejects limits", () => {
    expect(
      simplifyRoute([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(
      simplifyRoute([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 0 },
      ]),
    ).toHaveLength(3);
    expect(
      checkedWaypoints([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toEqual([]);
    expect(() =>
      checkedWaypoints([
        { x: NaN, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toThrow();
    expect(() =>
      checkedWaypoints(
        Array.from({ length: 35 }, (_, i) => ({ x: i, y: i % 2 })),
      ),
    ).toThrow("32");
    expect(() =>
      checkedWaypoints([
        { x: 10001, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toThrow();
  });
  it("validates fractional connection offsets in infographic fragments", () => {
    const s = fixture();
    s.groups = [{ id: "root", name: "流程", element_ids: ["a", "b"] }];
    s.connections![0].target_offset = 0.2;
    expect(() =>
      validateFragment({
        elements: s.elements,
        groups: s.groups,
        connections: s.connections,
        infographics: [],
      }),
    ).not.toThrow();
    s.connections![0].target_offset = 2;
    expect(() =>
      validateFragment({
        elements: s.elements,
        groups: s.groups,
        connections: s.connections,
        infographics: [],
      }),
    ).toThrow();
  });
});

describe("自由端点", () => {
  it("整体平移会脱离绑定并平移完整路径，复制页面保留自由线", async () => {
    const { translateConnection, freeConnectionEnd } =
      await import("@features/presentation-workshop/scene/connectionGeometry");
    const { copySlide } =
      await import("@features/presentation-workshop/templates");
    const { validConnection, patchConnection } =
      await import("@features/presentation-workshop/scene/connectionEditing");
    const s = fixture();
    const original = connectionPoints(s, s.connections![0]);
    const moved = translateConnection(s, s.connections![0], { x: 30, y: 40 });
    expect(moved).toMatchObject({ source_id: null, target_id: null });
    expect(connectionPoints(s, moved)).toEqual(
      original.map((p) => ({ x: p.x + 30, y: p.y + 40 })),
    );
    expect(validConnection(s, moved)).toBe(true);
    expect(patchConnection(s.connections![0], moved).waypoints).toEqual(
      moved.waypoints,
    );
    s.connections = [moved];
    const copied = copySlide(s);
    expect(connectionPoints(copied, copied.connections![0])).toEqual(
      connectionPoints(s, moved),
    );
    const mixed = reconnect(moved, "source", {
      id: "a",
      side: "right",
      offset: 0.5,
      point: { x: 300, y: 150 },
    });
    expect(mixed.source_point).toBeNull();
    expect(validConnection(s, mixed)).toBe(true);
    expect(
      freeConnectionEnd(mixed, "source", { x: 250, y: 300 }).source_id,
    ).toBeNull();
    expect(() => translateConnection(s, moved, { x: 10001, y: 0 })).toThrow();
  });
});
