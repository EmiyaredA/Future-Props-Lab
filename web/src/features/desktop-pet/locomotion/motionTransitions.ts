import type { PetEdge } from "@platform/petMotion";
import type { AuthoredPoseGeometry, PoseName } from "./authoredPose";

export type MotionTransitionEndpoint = {
  pose: "stand" | PoseName;
  facing: 1 | -1;
  edge?: PetEdge;
};
export type TransitionSupport = {
  edge: PetEdge;
  /** Model-space palm/sole contact, not a window or pointer coordinate. */
  point: [number, number];
};
export type MotionTransitionKeyframe<P> = {
  progress: number;
  /** Authored model-to-world reflection basis, separate from movement direction. */
  viewFacing?: 1 | -1;
  /** A registered runtime view, or a complete independently authored intermediate view. */
  pose: PoseName | P;
  supports?: Partial<
    Record<keyof AuthoredPoseGeometry["limbs"], TransitionSupport>
  >;
};
export type PoseTransition<P> = {
  id: string;
  from: MotionTransitionEndpoint;
  to: MotionTransitionEndpoint;
  durationMs: number;
  keyframes: MotionTransitionKeyframe<P>[];
};
export type AuthoredTransitions<P> = PoseTransition<P>[];

const poseNames: PoseName[] = [
  "walk",
  "held",
  "side",
  "top",
  "bottom",
  "glide",
];
const endpointNames = ["stand", ...poseNames] as const;
const edges: PetEdge[] = ["left", "right", "top", "bottom"];
const limbs = ["armNear", "armFar", "legBack", "legFront"] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const point = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => finite(n) && Math.abs(n) <= 512);
const exact = (
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) =>
  required.every((key) => key in value) &&
  Object.keys(value).every(
    (key) => required.includes(key) || optional.includes(key),
  );
const distance = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const fail = (): never => {
  throw new Error("动作过渡资源定义、姿势绑定或接触交接无效");
};
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  if (record(a) && record(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(
        ([key, value]) => key in b && equal(value, b[key]),
      )
    );
  return false;
};
function endpoint(value: unknown): MotionTransitionEndpoint {
  if (!record(value) || !exact(value, ["pose", "facing"], ["edge"]))
    return fail();
  const pose = endpointNames.find((name) => name === value.pose);
  if (!pose || (value.facing !== 1 && value.facing !== -1)) return fail();
  const edge = edges.find((name) => name === value.edge);
  if (
    (pose === "side" && edge !== "left" && edge !== "right") ||
    (pose === "top" && edge !== "top") ||
    (pose === "bottom" && edge !== "bottom") ||
    (!["side", "top", "bottom"].includes(pose) && "edge" in value)
  )
    return fail();
  return { pose, facing: value.facing, ...(edge ? { edge } : {}) };
}
function supports<P extends AuthoredPoseGeometry>(
  value: unknown,
  pose: P,
): NonNullable<MotionTransitionKeyframe<P>["supports"]> {
  if (!record(value)) return fail();
  const result: NonNullable<MotionTransitionKeyframe<P>["supports"]> = {};
  for (const [name, anchor] of Object.entries(value)) {
    const limb = limbs.find((candidate) => candidate === name);
    if (!limb || !record(anchor) || !exact(anchor, ["edge", "point"]))
      return fail();
    const edge = edges.find((candidate) => candidate === anchor.edge);
    if (
      !edge ||
      !point(anchor.point) ||
      distance(anchor.point, pose.limbs[limb].contact ?? pose.limbs[limb].end) >
        1
    )
      return fail();
    result[limb] = { edge, point: [...anchor.point] };
  }
  const anchors = Object.values(result);
  for (const edge of edges) {
    const axis = edge === "left" || edge === "right" ? 0 : 1;
    const coordinates = anchors
      .filter((anchor) => anchor.edge === edge)
      .map((anchor) => anchor.point[axis]);
    if (
      coordinates.length &&
      Math.max(...coordinates) - Math.min(...coordinates) > 1
    )
      return fail();
  }
  if (
    anchors.some((anchor) => anchor.edge === "top") &&
    ![result.armNear, result.armFar].some((anchor) => anchor?.edge === "top")
  )
    return fail();
  if (
    anchors.some((anchor) => anchor.edge === "bottom") &&
    anchors.filter((anchor) => anchor.edge === "bottom").length < 2
  )
    return fail();
  return result;
}

/** Profile-specific pose validation stays with its owner; this boundary owns direction and support transfer. */
export function readAuthoredTransitions<P extends AuthoredPoseGeometry>(
  value: unknown,
  poses: Record<PoseName, P>,
  readPose: (value: unknown) => P,
  partIds: (pose: P) => string[],
): AuthoredTransitions<P> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) return fail();
  const registered = new Map<string, P>();
  for (const pose of Object.values(poses))
    for (const id of partIds(pose)) registered.set(id, pose);
  const ids = new Set<string>();
  const directions = new Set<string>();
  return value.map((item) => {
    if (
      !record(item) ||
      !exact(item, ["id", "from", "to", "durationMs", "keyframes"]) ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) ||
      ids.has(item.id) ||
      !finite(item.durationMs) ||
      item.durationMs < 80 ||
      item.durationMs > 1500
    )
      return fail();
    ids.add(item.id);
    const from = endpoint(item.from),
      to = endpoint(item.to);
    const direction = JSON.stringify([from, to]);
    if (equal(from, to) || directions.has(direction)) return fail();
    directions.add(direction);
    const attached = from.edge !== undefined && to.edge !== undefined;
    const corner =
      from.edge !== undefined && to.edge !== undefined && from.edge !== to.edge;
    if (
      corner &&
      (([from.edge, to.edge].includes("left") &&
        [from.edge, to.edge].includes("right")) ||
        ([from.edge, to.edge].includes("top") &&
          [from.edge, to.edge].includes("bottom")))
    )
      return fail();
    if (
      !Array.isArray(item.keyframes) ||
      item.keyframes.length < (corner ? 3 : 2) ||
      item.keyframes.length > 8
    )
      return fail();
    const frames: unknown[] = item.keyframes;
    let previousProgress = -1;
    let previousSupports: NonNullable<
      MotionTransitionKeyframe<P>["supports"]
    > | null = null;
    const keyframes = frames.map(
      (frame, index): MotionTransitionKeyframe<P> => {
        if (
          !record(frame) ||
          !exact(frame, ["progress", "pose"], ["supports", "viewFacing"]) ||
          ("viewFacing" in frame &&
            frame.viewFacing !== 1 &&
            frame.viewFacing !== -1) ||
          !finite(frame.progress) ||
          frame.progress < 0 ||
          frame.progress > 1 ||
          frame.progress <= previousProgress ||
          (index === 0 && frame.progress !== 0) ||
          (index === frames.length - 1 && frame.progress !== 1)
        )
          return fail();
        previousProgress = frame.progress;
        const viewFacing =
          frame.viewFacing === 1 ? 1 : frame.viewFacing === -1 ? -1 : undefined;
        const name = poseNames.find((candidate) => candidate === frame.pose);
        if (typeof frame.pose === "string" && !name) return fail();
        if (
          name &&
          ((index === 0 && name !== from.pose) ||
            (index === frames.length - 1 && name !== to.pose))
        )
          return fail();
        const pose = name ? poses[name] : readPose(frame.pose);
        if (!name)
          for (const id of partIds(pose)) {
            const existing = registered.get(id);
            if (existing && !equal(existing, pose)) return fail();
            registered.set(id, pose);
          }
        const anchors = supports(
          frame.supports === undefined ? {} : frame.supports,
          pose,
        );
        const edge =
          index === 0
            ? from.edge
            : index === frames.length - 1
              ? to.edge
              : undefined;
        if (edge && !Object.values(anchors).some((a) => a.edge === edge))
          return fail();
        if (attached) {
          if (
            !Object.values(anchors).length ||
            Object.values(anchors).some(
              (a) => a.edge !== from.edge && a.edge !== to.edge,
            )
          )
            return fail();
          if (
            previousSupports &&
            !limbs.some((limb) => {
              const previous = previousSupports?.[limb],
                next = anchors[limb];
              return (
                previous &&
                next &&
                previous.edge === next.edge &&
                distance(previous.point, next.point) <= 1
              );
            })
          )
            return fail();
        }
        previousSupports = anchors;
        return {
          progress: frame.progress,
          pose: name ?? pose,
          ...(viewFacing === undefined ? {} : { viewFacing }),
          ...(frame.supports === undefined ? {} : { supports: anchors }),
        };
      },
    );
    return { id: item.id, from, to, durationMs: item.durationMs, keyframes };
  });
}
