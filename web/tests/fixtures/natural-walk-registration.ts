import type {
  AuthoredPose,
  PoseLimb,
} from "../../src/features/desktop-pet/locomotion/authoredPose";
import type { Point } from "../../src/features/desktop-pet/locomotion/articulation";

/** Geometry-only replacement for historical fully straight, mismatched-floor rigs. */
export function naturalWalkRegistration(base: AuthoredPose): AuthoredPose {
  const pose = structuredClone(base);
  for (const leg of ["legBack", "legFront"] as const) {
    const limb: PoseLimb = pose.limbs[leg];
    const upper = (80 * Math.PI) / 180,
      lower = (100 * Math.PI) / 180;
    limb.joint = [
      limb.root[0] + 30 * Math.cos(upper),
      limb.root[1] + 30 * Math.sin(upper),
    ];
    limb.end = [
      limb.joint[0] + 26 * Math.cos(lower),
      limb.joint[1] + 26 * Math.sin(lower),
    ];
    const offset = (limb.contact?.[0] ?? limb.end[0]) - limb.end[0];
    // Retain a small painted sole offset, but explicitly register this new
    // mathematical reference to a common floor. No source raster is altered.
    limb.contact = [
      limb.end[0] + Math.max(-4, Math.min(4, offset)),
      pose.edges.bottom[1],
    ] as Point;
    limb.bend = -1;
  }
  return pose;
}
