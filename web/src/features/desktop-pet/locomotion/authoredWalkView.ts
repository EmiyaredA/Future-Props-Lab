import type { AuthoredPoseGeometry } from "./authoredPose";
import type { ArticulationFrame, LimbName, Point } from "./articulation";
import type { RigState } from "../whale-vendor/rig/rig.js";
import { AuthoredWalkRuntime } from "./walkRuntime";

/** Movement intention and a native complete drawing's display basis are independent. */
export class AuthoredWalkView<P extends AuthoredPoseGeometry> {
  private readonly runtime: AuthoredWalkRuntime;
  private readonly axis: number;
  constructor(
    private readonly pose: P,
    travel: Point,
    facing: number,
    private readonly basis: number,
    scale: number,
    t: number,
    initialContacts?: Record<LimbName, boolean>,
  ) {
    this.axis = facing * basis;
    const solver = structuredClone(pose);
    if (this.axis < 0) {
      solver.waist = this.point(solver.waist);
      for (const limb of Object.values(solver.limbs)) {
        limb.root = this.point(limb.root);
        limb.joint = this.point(limb.joint);
        limb.end = this.point(limb.end);
        if (limb.contact) limb.contact = this.point(limb.contact);
        limb.limits = [
          -limb.limits[1],
          -limb.limits[0],
          -limb.limits[3],
          -limb.limits[2],
        ];
        limb.bend = limb.bend === 1 ? -1 : 1;
      }
    }
    this.runtime = new AuthoredWalkRuntime(
      solver,
      this.travel(travel, scale),
      facing,
      t,
      initialContacts,
    );
  }
  private point(p: Point): Point {
    return [this.pose.waist[0] + (p[0] - this.pose.waist[0]) * this.axis, p[1]];
  }
  private travel(travel: Point, scale: number): Point {
    return [(travel[0] / scale / this.basis) * this.axis, travel[1] / scale];
  }
  getMotionFailure() {
    return this.runtime.getMotionFailure();
  }
  sample(frame: ArticulationFrame, moving: boolean, facing: number) {
    const scale = Math.max(0.1, frame.worldScale ?? 1);
    const travel = frame.locomotion?.travel
      ? this.travel(
          [frame.locomotion.travel.x, frame.locomotion.travel.y],
          scale,
        )
      : this.runtime.confirmedTravel();
    const result = this.runtime.sample(frame.t, moving, travel, facing);
    if (this.axis > 0) return result;
    const state: RigState = { ...result.state };
    for (const [key, value] of Object.entries(state)) {
      if (key === "alpha" || key === "z") continue;
      state[key] = {
        ...value,
        a: -Number(value.a ?? 0),
        tx: -Number(value.tx ?? 0),
        ...(value.pivot ? { pivot: this.point(value.pivot as Point) } : {}),
      };
    }
    return {
      ...result,
      state,
      endpoints: Object.fromEntries(
        Object.entries(result.endpoints).map(([name, p]) => [
          name,
          this.point(p),
        ]),
      ) as typeof result.endpoints,
    };
  }
}
