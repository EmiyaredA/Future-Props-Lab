export const SHAPES = [
  "rectangle",
  "rounded",
  "ellipse",
  "diamond",
  "text",
  "icon",
  "image",
  "frame",
] as const;
export const ICONS = [
  "server",
  "database",
  "user",
  "file",
  "cloud",
  "cpu",
  "network",
  "lock",
  "mail",
  "clock",
  "globe",
  "code",
] as const;
export type CanvasAnchor = "left" | "right" | "top" | "bottom";
export type CanvasElement = {
  id: string;
  kind: (typeof SHAPES)[number];
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fill: string;
  stroke: string;
  icon?: (typeof ICONS)[number];
  assetId?: string;
  parentId?: string;
  fontSize?: number;
  textAlign?: "left" | "center" | "right";
};
export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  arrow: boolean;
  style: "straight" | "step";
  sourceAnchor?: CanvasAnchor;
  targetAnchor?: CanvasAnchor;
};
export type CanvasScene = {
  sceneVersion: 1 | 2;
  title: string;
  elements: CanvasElement[];
  edges: CanvasEdge[];
};
export const emptyScene = (): CanvasScene => ({
  sceneVersion: 1,
  title: "信息图",
  elements: [],
  edges: [],
});
export function canvasAssetIds(scene: CanvasScene): string[] {
  return [
    ...new Set(
      scene.elements.flatMap((e) =>
        e.kind === "image" && e.assetId ? [e.assetId] : [],
      ),
    ),
  ];
}
export function mapCanvasAssets(
  scene: CanvasScene,
  map: (id: string) => string,
): CanvasScene {
  return {
    ...scene,
    elements: scene.elements.map((e) =>
      e.kind === "image" && e.assetId
        ? { ...e, assetId: map(e.assetId) }
        : { ...e },
    ),
    edges: scene.edges.map((e) => ({ ...e })),
  };
}
export function canvasText(scene: CanvasScene) {
  return [
    scene.title,
    ...scene.elements.map((e) => e.text),
    ...scene.edges.map((e) => e.label),
  ].join("\n");
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).every((k) => names.includes(k));
const text = (v: unknown) =>
  typeof v === "string" && Array.from(v).length <= 5000;
const numeric = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 100000;
export function parseCanvasScene(value: unknown): CanvasScene {
  const fail = () => {
    throw new Error("画板数据无效或版本不支持");
  };
  if (
    !object(value) ||
    !keys(value, ["sceneVersion", "title", "elements", "edges"]) ||
    ![1, 2].includes(Number(value.sceneVersion)) ||
    !text(value.title) ||
    !Array.isArray(value.elements) ||
    !Array.isArray(value.edges) ||
    value.elements.length > 1000 ||
    value.edges.length > 2000
  )
    return fail();
  const ids = new Set<string>();
  for (const e of value.elements) {
    if (
      !object(e) ||
      !keys(e, [
        "id",
        "kind",
        "x",
        "y",
        "width",
        "height",
        "text",
        "fill",
        "stroke",
        "icon",
        "assetId",
        "parentId",
        ...(value.sceneVersion === 2 ? ["fontSize", "textAlign"] : []),
      ]) ||
      typeof e.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(e.id) ||
      ids.has(e.id) ||
      !SHAPES.includes(e.kind as CanvasElement["kind"]) ||
      (e.fontSize !== undefined && (typeof e.fontSize !== "number" || !Number.isInteger(e.fontSize) || e.fontSize < 10 || e.fontSize > 72)) ||
      (e.textAlign !== undefined && !["left", "center", "right"].includes(String(e.textAlign))) ||
      !text(e.text) ||
      ![e.x, e.y, e.width, e.height].every(numeric) ||
      Number(e.width) < 20 ||
      Number(e.height) < 20 ||
      ![e.fill, e.stroke].every(
        (c) => typeof c === "string" && /^#[\da-fA-F]{6}$/.test(c),
      ) ||
      (e.icon !== undefined &&
        !ICONS.includes(e.icon as (typeof ICONS)[number])) ||
      (e.kind === "image" &&
        (typeof e.assetId !== "string" ||
          !e.assetId ||
          e.assetId.length > 500)) ||
      (e.kind !== "image" && e.assetId !== undefined)
    )
      return fail();
    ids.add(e.id);
  }
  const scene = value as CanvasScene;
  for (const e of scene.elements) {
    if (
      e.parentId !== undefined &&
      (typeof e.parentId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(e.parentId))
    )
      return fail();
    if (e.parentId && (!ids.has(e.parentId) || e.parentId === e.id))
      return fail();
    const parent = scene.elements.find((p) => p.id === e.parentId);
    if (
      parent &&
      (parent.kind !== "frame" || parent.parentId || e.kind === "frame")
    )
      return fail();
  }
  const edges = new Set<string>();
  for (const e of value.edges) {
    if (
      !object(e) ||
      !keys(e, ["id", "source", "target", "label", "arrow", "style", ...(value.sceneVersion === 2 ? ["sourceAnchor", "targetAnchor"] : [])]) ||
      typeof e.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(e.id) ||
      [e.sourceAnchor, e.targetAnchor].some(a => a !== undefined && !["left", "right", "top", "bottom"].includes(String(a))) ||
      edges.has(e.id) ||
      ids.has(e.id) ||
      typeof e.source !== "string" ||
      typeof e.target !== "string" ||
      !ids.has(e.source) ||
      !ids.has(e.target) ||
      e.source === e.target ||
      !text(e.label) ||
      typeof e.arrow !== "boolean" ||
      typeof e.style !== "string" ||
      !["straight", "step"].includes(e.style)
    )
      return fail();
    edges.add(e.id);
  }
  return scene;
}
export function sceneBounds(scene: CanvasScene) {
  if (!scene.elements.length) return {x:-24,y:-24,width:448,height:228};
  const x = Math.min(...scene.elements.map(e => e.x)) - 24;
  const y = Math.min(...scene.elements.map(e => e.y)) - 24;
  return {x, y, width: Math.max(...scene.elements.map(e => e.x + e.width)) - x + 24, height: Math.max(...scene.elements.map(e => e.y + e.height)) - y + 24};
}
export function anchorPoint(e: CanvasElement, side: CanvasAnchor) {
  return { x: e.x + (side === "left" ? 0 : side === "right" ? e.width : e.width / 2), y: e.y + (side === "top" ? 0 : side === "bottom" ? e.height : e.height / 2) };
}
export function canvasLines(e: CanvasElement) {
  const size = e.fontSize ?? 15;
  return e.text.split("\n").flatMap(line => {
    const rows: string[] = []; let row = "", used = 0;
    for (const char of line) {
      const advance = (char.codePointAt(0)! <= 127 ? 8 : 15) * size / 15;
      if (row && used + advance > Math.max(size, e.width - 24)) { rows.push(row); row = ""; used = 0; }
      row += char; used += advance;
    }
    return [...rows, row];
  });
}
export function canvasTextHeight(e: CanvasElement) { return canvasLines(e).length * (e.fontSize ?? 15) * 4 / 3 + (e.kind === "icon" ? 42 : 12); }
export function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  step: boolean,
  vertical = false,
) {
  return step
    ? vertical ? `M${x1},${y1} V${(y1 + y2) / 2} H${x2} V${y2}` : `M${x1},${y1} H${(x1 + x2) / 2} V${y2} H${x2}`
    : `M${x1},${y1} L${x2},${y2}`;
}
