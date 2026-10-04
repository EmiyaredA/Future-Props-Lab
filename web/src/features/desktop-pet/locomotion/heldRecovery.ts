import type { RigState } from "../whale-vendor/rig/rig.js";
import type { AuthoredPoseGeometry } from "./authoredPose";

const names = ["armNear", "armFar", "legBack", "legFront"] as const;
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));
const ease = (u: number) => {
  const v = clamp(u, 0, 1);
  return v * v * (3 - 2 * v);
};
const degrees = (state: RigState | undefined, key: string) =>
  Number(state?.[key]?.a ?? 0);

/** Only a single complete held view is blended. Different cores are never morphed. */
export function relaxedHeldPose(
  pose: AuthoredPoseGeometry,
  base: RigState,
  swing: number,
  blend: number,
  previous?: RigState,
): RigState {
  const mix = (key: string, target: number) =>
    degrees(previous, key) * (1 - blend) + target * blend;
  const state: RigState = { ...base, alpha: { ...base.alpha } };
  // Small actual inertial swing belongs to the bent core, around the current grip.
  // The head/neck is part of that core; there is no opposite neck correction.
  if (previous)
    state.body = { ...base.body, a: mix("body", degrees(base, "body")) };
  for (const [index, name] of names.entries()) {
    const limb = pose.limbs[name],
      leg = index >= 2;
    // The complete held view already draws relaxed shoulders and downward
    // hands. Keep those authored axes at rest rather than forcing every chain
    // onto an invented vertical pose. Only actual dragging adds small inertia.
    const drift = -swing * (leg ? 0.22 : 0.32);
    const upper = clamp(drift, limb.limits[0], limb.limits[1]);
    const lower = clamp(-drift * 0.35, limb.limits[2], limb.limits[3]);
    state[name] = { a: mix(name, upper), pivot: limb.root };
    state[`${name}Lower`] = {
      a: mix(`${name}Lower`, lower),
      pivot: limb.joint,
    };
    state[`${name}End`] = {
      a: mix(`${name}End`, -upper - lower),
      pivot: limb.end,
    };
  }
  return state;
}

/** A release window damps the displayed held chain; it does not invent an upright view. */
export class HeldReleaseWindow {
  readonly duration = 0.24;
  constructor(
    readonly pose: AuthoredPoseGeometry,
    readonly source: RigState,
    readonly at: number,
  ) {}
  sample(t: number) {
    const progress = clamp((t - this.at) / this.duration, 0, 1);
    return {
      progress,
      state: relaxedHeldPose(
        this.pose,
        { ...this.source, body: { ...this.source.body, a: 0 } },
        0,
        ease(progress),
        this.source,
      ),
    };
  }
}
