import type { PoseLimb } from "./authoredPose";
import type { RigState } from "../whale-vendor/rig/rig.js";

/** Free arms hang from the moving shoulder; the palm is not an IK wrist target. */
export function walkArmPose(
  limb: PoseLimb,
  phase: number,
  blend: number,
  previous?: RigState,
  key = "armNear",
) {
  const clamp = (value: number, low: number, high: number) =>
    Math.max(low, Math.min(high, value));
  const sway = Math.sin(phase + Math.PI) * 8;
  // Source shoulders and sleeves already describe their perspective. Forcing
  // every source axis to 90 degrees can rotate the far shoulder over 40 degrees.
  const upper = clamp(sway, limb.limits[0], limb.limits[1]);
  const lower = clamp(
    -limb.bend * (5 + 3 * Math.cos(phase)),
    limb.limits[2],
    limb.limits[3],
  );
  const distal = -upper * 0.35 - lower * 0.2;
  const from = (id: string) => Number(previous?.[id]?.a ?? 0);
  return {
    [key]: { a: from(key) * (1 - blend) + upper * blend, pivot: limb.root },
    [`${key}Lower`]: {
      a: from(`${key}Lower`) * (1 - blend) + lower * blend,
      pivot: limb.joint,
    },
    [`${key}End`]: {
      a: from(`${key}End`) * (1 - blend) + distal * blend,
      pivot: limb.end,
    },
  };
}
