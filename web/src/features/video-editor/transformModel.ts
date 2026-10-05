import { previewTransitionEffectForClip } from "./previewTransitions";
import { clipPropertyAt } from "./editorModel";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimeline,
} from "./types";
import type { TimelineEdit, TimelineEditBuilder } from "./timelineSaveQueue";

export const defaultTransform = {
  x: 960,
  y: 540,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  brightness: 1,
  anchor: "center" as const,
};
export type ClipTransform = Omit<typeof defaultTransform, "anchor"> & {
  anchor: "center" | "topLeft" | "bottomCenter";
};
export type TransformProperty = Exclude<keyof ClipTransform, "anchor">;
export type TransformValues = Partial<Record<TransformProperty, number>>;
export type TransformDraft = {
  clipId: string;
  revision: number;
  playheadUs: number;
  values: TransformValues;
};
export type Point = { x: number; y: number };
export type TransformGeometry = {
  width: number;
  height: number;
  flipX?: boolean;
  multiplier?: number;
};
export type TransformHandle =
  "move" | "rotate" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const handlePoints: Record<
  Exclude<TransformHandle, "move" | "rotate">,
  Point
> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function transformAt(
  clip: VideoEditorClip,
  localUs: number,
): ClipTransform {
  const base: ClipTransform = { ...defaultTransform, ...clip.transform };
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [
      key,
      key === "anchor"
        ? value
        : clipPropertyAt(
            clip,
            key as TransformProperty,
            localUs,
            value as number,
          ),
    ]),
  ) as ClipTransform;
}
/** The renderer evaluates visual properties at the continuous media time across seams. */
export function transformLocalUs(
  clip: VideoEditorClip,
  playheadUs: number,
  timeline?: VideoEditorTimeline,
): number {
  const nominal = Math.max(
    0,
    Math.min(clip.durationUs, playheadUs - clip.timelineStartUs),
  );
  if (!timeline) return nominal;
  const clipsById = new Map(
    (timeline.document.tracks ?? []).flatMap((track) =>
      (track.clips ?? []).map((item) => [item.id, item] as const),
    ),
  );
  return (
    previewTransitionEffectForClip(
      clip,
      playheadUs,
      timeline.document.transitions ?? [],
      clipsById,
    ).forceLocalUs ?? nominal
  );
}
export function anchorPoint(anchor: ClipTransform["anchor"]): Point {
  return anchor === "topLeft"
    ? { x: 0, y: 0 }
    : { x: 0.5, y: anchor === "bottomCenter" ? 1 : 0.5 };
}
export function rotatePoint(point: Point, degrees: number): Point {
  const angle = (degrees * Math.PI) / 180;
  return {
    x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
  };
}
export function transformPoint(
  point: Point,
  transform: ClipTransform,
  geometry: TransformGeometry,
): Point {
  const anchor = anchorPoint(transform.anchor);
  const vector = rotatePoint(
    {
      x:
        (point.x - anchor.x) *
        geometry.width *
        transform.scaleX *
        (geometry.multiplier ?? 1),
      y:
        (point.y - anchor.y) *
        geometry.height *
        transform.scaleY *
        (geometry.multiplier ?? 1),
    },
    transform.rotation,
  );
  return { x: transform.x + vector.x, y: transform.y + vector.y };
}

/** Resize in the layer's rotated axes, keeping the opposite point fixed. */
export function gestureTransform(
  initial: ClipTransform,
  geometry: TransformGeometry,
  handle: TransformHandle,
  start: Point,
  end: Point,
  snapRotation = false,
  previousRotation = initial.rotation,
): ClipTransform {
  if (handle === "move")
    return {
      ...initial,
      x: initial.x + end.x - start.x,
      y: initial.y + end.y - start.y,
    };
  if (handle === "rotate") {
    const angle = (p: Point) =>
      (Math.atan2(p.y - initial.y, p.x - initial.x) * 180) / Math.PI;
    if (Math.hypot(end.x - initial.x, end.y - initial.y) < 0.001)
      return { ...initial, rotation: previousRotation };
    let rotation = initial.rotation + angle(end) - angle(start);
    rotation += Math.round((previousRotation - rotation) / 360) * 360;
    return {
      ...initial,
      rotation: clamp(
        snapRotation ? Math.round(rotation / 15) * 15 : rotation,
        -3600,
        3600,
      ),
    };
  }
  const moving = handlePoints[handle];
  const fixed = { x: 1 - moving.x, y: 1 - moving.y };
  const fixedWorld = transformPoint(fixed, initial, geometry);
  const delta = rotatePoint(
    { x: end.x - start.x, y: end.y - start.y },
    -initial.rotation,
  );
  const dx = (moving.x - fixed.x) * geometry.width * (geometry.multiplier ?? 1);
  const dy =
    (moving.y - fixed.y) * geometry.height * (geometry.multiplier ?? 1);
  let scaleX = initial.scaleX;
  let scaleY = initial.scaleY;
  if (dx && dy) {
    const vx = dx * scaleX,
      vy = dy * scaleY;
    const ratio = clamp(
      ((vx + delta.x) * vx + (vy + delta.y) * vy) / (vx * vx + vy * vy),
      Math.max(0.01 / scaleX, 0.01 / scaleY),
      Math.min(20 / scaleX, 20 / scaleY),
    );
    scaleX *= ratio;
    scaleY *= ratio;
  } else if (dx) scaleX = clamp(scaleX + delta.x / dx, 0.01, 20);
  else if (dy) scaleY = clamp(scaleY + delta.y / dy, 0.01, 20);
  const next = { ...initial, scaleX, scaleY };
  const offset = transformPoint(fixed, { ...next, x: 0, y: 0 }, geometry);
  return { ...next, x: fixedWorld.x - offset.x, y: fixedWorld.y - offset.y };
}
export function changedTransform(
  before: ClipTransform,
  after: ClipTransform,
): TransformValues {
  return Object.fromEntries(
    (Object.keys(defaultTransform) as (keyof ClipTransform)[])
      .filter(
        (key): key is TransformProperty =>
          key !== "anchor" && Math.abs(after[key] - before[key]) > 1e-7,
      )
      .map((key) => [key, after[key]]),
  );
}
export function boundedTransformValue(
  property: TransformProperty,
  value: number,
): number {
  if (!Number.isFinite(value)) throw new Error("请输入有效数值");
  if (property === "scaleX" || property === "scaleY")
    return clamp(value, 0.01, 20);
  if (property === "rotation") return clamp(value, -3600, 3600);
  if (property === "opacity") return clamp(value, 0, 1);
  if (property === "brightness") return clamp(value, 0, 2);
  return value;
}
export function transformOperations(
  clip: VideoEditorClip,
  playheadUs: number,
  values: TransformValues,
  forceKeyframe = false,
): TimelineEdit {
  const redo: VideoEditorOperation[] = [],
    undo: VideoEditorOperation[] = [];
  const localUs = clamp(
    Math.round(playheadUs - clip.timelineStartUs),
    0,
    clip.durationUs,
  );
  const base = { ...defaultTransform, ...clip.transform };
  const patch: TransformValues = {};
  for (const [property, raw] of Object.entries(values) as [
    TransformProperty,
    number,
  ][]) {
    const value = boundedTransformValue(property, raw);
    const keys = (clip.keyframes ?? []).filter(
      (key) => key.property === property,
    );
    if (forceKeyframe || keys.length) {
      const existing = keys.find((key) => key.timeUs === localUs);
      if (existing?.value === value && !forceKeyframe) continue;
      const keyframe = {
        id: existing?.id ?? crypto.randomUUID(),
        property,
        timeUs: localUs,
        value,
        interpolation: existing?.interpolation ?? ("linear" as const),
      };
      redo.push({
        type: existing ? "updateKeyframe" : "addKeyframe",
        clipId: clip.id,
        keyframe,
      });
      undo.unshift(
        existing
          ? { type: "updateKeyframe", clipId: clip.id, keyframe: existing }
          : {
              type: "removeKeyframe",
              clipId: clip.id,
              keyframeId: keyframe.id,
            },
      );
    } else if (base[property] !== value) patch[property] = value;
  }
  if (Object.keys(patch).length) {
    redo.push({
      type: "updateClip",
      clipId: clip.id,
      patch: { transform: { ...base, ...patch } },
    });
    undo.unshift({
      type: "updateClip",
      clipId: clip.id,
      patch: { transform: clip.transform ?? null },
    });
  }
  return { redo, undo };
}
export function transformEdit(
  clipId: string,
  playheadUs: number,
  values: TransformValues,
  options: { revision?: number; forceKeyframe?: boolean } = {},
): TimelineEditBuilder {
  return (timeline) => {
    if (
      options.revision !== undefined &&
      options.revision !== timeline.revision
    )
      throw new Error("工程已变化，本次变换未提交");
    const track = timeline.document.tracks?.find((item) =>
      item.clips?.some((clip) => clip.id === clipId),
    );
    const clip = track?.clips?.find((item) => item.id === clipId);
    if (!clip || track?.locked) throw new Error("片段不存在或轨道已锁定");
    return transformOperations(
      clip,
      clip.timelineStartUs + transformLocalUs(clip, playheadUs, timeline),
      values,
      options.forceKeyframe,
    );
  };
}
