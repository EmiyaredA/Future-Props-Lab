import type { VisualCanvasNode } from "@features/visual-workshop/api";
import {
  exceedsCanvasDragThreshold,
  moveCanvasNodes,
  nodesIntersectingRect,
  snapCanvasNodes,
} from "@features/visual-workshop/canvas/useCanvasPointerInteractions";

const nodes: VisualCanvasNode[] = [
  {
    id: "image-1",
    kind: "image",
    title: "图片1",
    position: { x: 100, y: 120 },
    asset_id: null,
  },
  {
    id: "video-1",
    kind: "video",
    title: "视频1",
    position: { x: 500, y: 360 },
    asset_id: null,
  },
  {
    id: "audio-1",
    kind: "audio",
    title: "音频1",
    position: { x: 900, y: 700 },
    asset_id: null,
  },
];

test("uses a zoom-independent screen-space drag threshold", () => {
  expect(exceedsCanvasDragThreshold(3, 2)).toBe(false);
  expect(exceedsCanvasDragThreshold(4, 3)).toBe(true);
});

test("finds every node touched by a marquee rectangle", () => {
  expect(
    nodesIntersectingRect(nodes, {
      left: 80,
      top: 90,
      right: 830,
      bottom: 600,
    }),
  ).toEqual(["image-1", "video-1"]);
});

test("moves selected nodes as a group", () => {
  const moved = moveCanvasNodes(
    nodes,
    [
      { id: "image-1", x: 100, y: 120 },
      { id: "video-1", x: 500, y: 360 },
    ],
    40,
    -20,
  );
  expect(moved.map((node) => node.position)).toEqual([
    { x: 140, y: 100 },
    { x: 540, y: 340 },
    { x: 900, y: 700 },
  ]);
});

test("snaps horizontal and vertical anchors to stationary nodes", () => {
  const snapped = snapCanvasNodes(
    nodes,
    [{ id: "image-1", x: 100, y: 120 }],
    396,
    236,
    1,
  );
  expect(snapped.deltaX).toBe(400);
  expect(snapped.deltaY).toBe(240);
  expect(snapped.guides.map((guide) => guide.axis)).toEqual([
    "vertical",
    "horizontal",
  ]);
});
