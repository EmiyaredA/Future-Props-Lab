import type {
  MotionComposition,
  MotionKeyframe,
  MotionLayer,
  MotionMask,
  MotionAsset,
  ResolvedDocument,
} from "./types";

export function createLayer(
  kind: MotionLayer["kind"],
  document: ResolvedDocument,
  asset?: MotionAsset,
): MotionLayer {
  const width = kind === "shape" ? 500 : kind === "text" ? 600 : 960;
  const height = kind === "shape" ? 300 : kind === "text" ? 180 : 540;
  return {
    id: crypto.randomUUID(),
    name:
      asset?.displayName ??
      {
        image: "图片图层",
        video: "视频图层",
        text: "新建标题",
        shape: "图形图层",
      }[kind],
    kind,
    visible: true,
    locked: false,
    startFrame: 0,
    endFrame: document.settings.durationFrames,
    sourceStartUs: 0,
    assetId: asset?.id ?? null,
    text: kind === "text" ? "新建标题" : "",
    fontSize: 96,
    shape: "rect",
    width,
    height,
    fill: kind === "shape" ? "#e73548" : "#fff8ec",
    stroke: "#111318",
    transform: {
      x: document.settings.width / 2,
      y: document.settings.height / 2,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    },
    mask: null,
    effects: { outline: 0, shadow: 0, halftone: 0, duotone: false },
    keyframes: [],
  };
}

export function cloneDocument(document: MotionComposition): ResolvedDocument {
  return structuredClone(document) as ResolvedDocument;
}

export function updateLayer(
  document: ResolvedDocument,
  id: string,
  change: (layer: MotionLayer) => MotionLayer,
): ResolvedDocument {
  const next = cloneDocument(document);
  next.layers = next.layers.map((layer) =>
    layer.id === id ? change(layer) : layer,
  );
  return next;
}

export function valueAt(
  layer: MotionLayer,
  property: MotionKeyframe["property"],
  frame: number,
): number {
  frame -= layer.startFrame;
  const keys = (layer.keyframes ?? [])
    .filter((item) => item.property === property)
    .sort((a, b) => a.frame - b.frame);
  const initial = (layer.transform ?? {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
  })[property];
  if (!keys.length || frame < keys[0].frame) return initial;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
  const index = keys.findIndex((item) => item.frame > frame);
  const left = keys[index - 1],
    right = keys[index];
  let t = (frame - left.frame) / Math.max(1, right.frame - left.frame);
  if (right.interpolation === "hold") t = 0;
  if (right.interpolation === "ease-in") t *= t;
  if (right.interpolation === "ease-out") t = 1 - (1 - t) ** 2;
  if (right.interpolation === "ease-in-out") t = t * t * (3 - 2 * t);
  return left.value + (right.value - left.value) * t;
}

export function pointsAt(
  mask: MotionMask,
  frame: number,
): MotionMask["points"] {
  const keys = [...(mask.keyframes ?? [])].sort((a, b) => a.frame - b.frame);
  if (!keys.length || frame < keys[0].frame) return mask.points;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].points;
  const index = keys.findIndex((item) => item.frame > frame);
  const left = keys[index - 1],
    right = keys[index];
  const t = (frame - left.frame) / Math.max(1, right.frame - left.frame);
  return left.points.map((point, i) => {
    const other = right.points[i];
    return Object.fromEntries(
      Object.entries(point).map(([key, value]) => [
        key,
        value + (other[key as keyof typeof other] - value) * t,
      ]),
    ) as typeof point;
  });
}

export function defaultMask(layer: MotionLayer): MotionMask {
  const width = layer.width,
    height = layer.height;
  const point = (x: number, y: number) => ({
    x,
    y,
    inX: 0,
    inY: 0,
    outX: 0,
    outY: 0,
  });
  return {
    points: [
      point(width * 0.12, height * 0.1),
      point(width * 0.88, height * 0.1),
      point(width * 0.88, height * 0.9),
      point(width * 0.12, height * 0.9),
    ],
    keyframes: [],
    feather: 0,
    inverted: false,
  };
}

export function maskPath(
  points: MotionMask["points"],
  width: number,
  height: number,
): string {
  if (!points.length) return "";
  let result = `M ${points[0].x - width / 2} ${points[0].y - height / 2}`;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    result += ` C ${a.x + a.outX - width / 2} ${a.y + a.outY - height / 2} ${b.x + b.inX - width / 2} ${b.y + b.inY - height / 2} ${b.x - width / 2} ${b.y - height / 2}`;
  }
  return result + " Z";
}
