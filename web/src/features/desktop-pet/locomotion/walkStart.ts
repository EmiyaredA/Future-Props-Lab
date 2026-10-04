import type { AuthoredPoseGeometry } from "./authoredPose";
import type { LimbName, Point } from "./articulation";

const legs = ["legBack", "legFront"] as const;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => {
  const u = clamp(n);
  return u * u * (3 - 2 * u);
};

/** The first short step begins at the actual painted rest sole, not a stride target. */
export class WalkStartTransition {
  readonly phase: number;
  readonly bodyY: number;
  private readonly support: (typeof legs)[number];
  private readonly releasePhase: number;
  private readonly touchdownPhase: number;
  private currentTravel: Point;
  private currentPhase: number;
  constructor(
    private readonly pose: AuthoredPoseGeometry,
    private readonly at: number,
    private readonly travel: Point,
  ) {
    this.support = legs.reduce((a, b) =>
      (pose.limbs[a].contact ?? pose.limbs[a].end)[1] >=
      (pose.limbs[b].contact ?? pose.limbs[b].end)[1]
        ? a
        : b,
    );
    const limb = pose.limbs[this.support];
    const sole = limb.contact ?? limb.end;
    this.bodyY = pose.edges.bottom[1] - sole[1];
    const u = Math.max(
      0.12,
      Math.min(0.48, 0.3 - (limb.end[0] - limb.root[0]) / (pose.stride ?? 60)),
    );
    this.phase = 2 * Math.PI * u + (this.support === "legFront" ? Math.PI : 0);
    this.releasePhase = this.phase + 2 * Math.PI * (0.6 - u);
    this.touchdownPhase = this.phase + 2 * Math.PI * (0.5 - u);
    this.currentTravel = [...travel];
    this.currentPhase = this.phase;
  }
  sample(t: number, phase: number, travel: Point, gaitLift: number) {
    this.currentTravel = travel;
    this.currentPhase = phase;
    let bodyLift =
      this.bodyY * (1 - ease((t - this.at) / 0.2)) +
      gaitLift * ease((t - this.at) / 0.2);
    const pinned = this.foot(this.support, [0, 0]);
    if (pinned?.contact && (t > this.at || phase !== this.phase)) {
      const limb = this.pose.limbs[this.support];
      const sole = limb.contact ?? limb.end;
      const reach =
        Math.hypot(limb.joint[0] - limb.root[0], limb.joint[1] - limb.root[1]) +
        Math.hypot(limb.end[0] - limb.joint[0], limb.end[1] - limb.joint[1]) -
        0.01;
      const dx = pinned.target[0] - (sole[0] - limb.end[0]) - limb.root[0];
      const vertical = Math.sqrt(Math.max(0, reach * reach - dx * dx));
      // The planted ankle stays fixed while the pelvis makes room for its reach.
      bodyLift = Math.max(
        bodyLift,
        pinned.target[1] - (sole[1] - limb.end[1]) - limb.root[1] - vertical,
      );
    }
    return {
      bodyLift,
      first:
        t === this.at &&
        phase === this.phase &&
        travel[0] === this.travel[0] &&
        travel[1] === this.travel[1],
      blend: this.freeProgress(),
    };
  }
  private freeProgress() {
    return ease(
      (this.currentPhase - this.phase) / (this.touchdownPhase - this.phase),
    );
  }
  foot(name: LimbName, regular: Point) {
    if (!name.startsWith("leg")) return null;
    const limb = this.pose.limbs[name];
    const sole = limb.contact ?? limb.end;
    const rest: Point = [
      sole[0] - this.currentTravel[0] + this.travel[0],
      sole[1] + this.bodyY - this.currentTravel[1] + this.travel[1],
    ];
    if (name === this.support && this.currentPhase < this.releasePhase)
      return { target: rest, contact: true };
    if (name !== this.support && this.currentPhase < this.touchdownPhase) {
      const u = this.freeProgress();
      return {
        target: [
          rest[0] + (regular[0] - rest[0]) * u,
          rest[1] + (regular[1] - rest[1]) * u,
        ] as Point,
        contact: false,
      };
    }
    return null;
  }
}
