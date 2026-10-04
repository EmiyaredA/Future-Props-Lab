import type { RigPart } from "../../whale-vendor/rig/rig.js";
import type { AuthoredPoseGeometry, PoseName } from "../authoredPose";
import { skinAuthoredPart } from "../poseSkin";
import type { AuthoredTransitionOptions } from "./transitionPlayer";

export type AuthoredViewBinding<P extends AuthoredPoseGeometry> = {
  pose: P;
  skinMode: PoseName;
};

/** All complete views are bound once, including native inline transition artwork. */
export function authoredViewBindings<P extends AuthoredPoseGeometry>(
  poses: Record<PoseName, P>,
  options: AuthoredTransitionOptions<P> = {},
): Record<string, AuthoredViewBinding<P>> {
  const views = Object.fromEntries(
    Object.entries(poses).map(([name, pose]) => [
      name,
      { pose, skinMode: name as PoseName },
    ]),
  );
  if (options.stand) views.stand = { pose: options.stand, skinMode: "walk" };
  const standParts = new Set(options.stand ? [options.stand.part] : []);
  for (const transition of options.transitions ?? [])
    for (const [endpoint, frame] of [
      [transition.from, transition.keyframes[0]],
      [transition.to, transition.keyframes.at(-1)!],
    ] as const)
      if (endpoint.pose === "stand" && typeof frame.pose !== "string") {
        standParts.add(frame.pose.part);
        views[`stand:${endpoint.facing}`] = {
          pose: frame.pose,
          skinMode: "walk",
        };
      }
  for (const transition of options.transitions ?? [])
    transition.keyframes.forEach((frame, index) => {
      if (typeof frame.pose !== "string") {
        const inlinePose = frame.pose;
        const canonical = Object.entries(poses).find(
          ([, pose]) => pose.part === inlinePose.part,
        );
        views[`transition:${transition.id}:${index}`] = {
          pose: frame.pose,
          skinMode: standParts.has(inlinePose.part)
            ? "walk"
            : canonical
              ? (canonical[0] as PoseName)
              : transition.to.pose === "stand"
                ? "walk"
                : transition.to.pose,
        };
      }
    });
  return views;
}

export function posePartIds(pose: AuthoredPoseGeometry): string[] {
  return [
    pose.part,
    ...(pose.head ? [pose.head.part] : []),
    ...Object.values(pose.limbs).flatMap(
      (limb) => limb.segments ?? (limb.part ? [limb.part] : []),
    ),
  ];
}

/** Pose bindings are renderer-owned; package parts keep their validated body parent. */
export function bindPoseParts(
  parts: RigPart[],
  poses: Partial<Record<PoseName, AuthoredPoseGeometry>>,
): RigPart[] {
  return bindAuthoredViews(
    parts,
    Object.fromEntries(
      Object.entries(poses).map(([name, pose]) => [
        name,
        { pose, skinMode: name as PoseName },
      ]),
    ),
  );
}

export function bindAuthoredViews<P extends AuthoredPoseGeometry>(
  parts: RigPart[],
  views: Record<string, AuthoredViewBinding<P>>,
): RigPart[] {
  const bindings = new Map<
    string,
    {
      pose: AuthoredPoseGeometry;
      name: PoseName;
      parent?: string;
      skinned: boolean;
    }
  >();
  for (const { skinMode: name, pose } of Object.values(views)) {
    if (pose.head)
      bindings.set(pose.head.part, {
        pose,
        name,
        skinned: false,
        parent: "head",
      });
    bindings.set(pose.part, {
      pose,
      name,
      skinned: !Object.values(pose.limbs).every(
        (limb) => limb.part || limb.segments,
      ),
    });
    for (const [limbName, limb] of Object.entries(pose.limbs)) {
      if (limb.part) bindings.set(limb.part, { pose, name, skinned: true });
      limb.segments?.forEach((id, i) =>
        bindings.set(id, {
          pose,
          name,
          skinned: false,
          parent: [limbName, `${limbName}Lower`, `${limbName}End`][i],
        }),
      );
    }
  }
  return parts.map((part) => {
    const binding = bindings.get(part.id);
    if (!binding) return part;
    if (binding.parent)
      return { ...part, parent: binding.parent, grid: [1, 1], skin: undefined };
    return binding.skinned
      ? skinAuthoredPart(part, binding.pose, binding.name)
      : part;
  });
}
