import type { AuthoredPoseGeometry, PoseName } from "./authoredPose";
import type { LimbName, Point } from "./articulation";
import type { RigPart } from "../whale-vendor/rig/rig.js";
import { buildRegionMesh, gridMesh } from "../whale-vendor/rig/meshGeometry.js";

const names: LimbName[] = ["armNear", "armFar", "legBack", "legFront"];
const smooth = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};
const axis = (a: Point, b: Point): Point => {
  const length = Math.max(0.01, Math.hypot(b[0] - a[0], b[1] - a[1]));
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
};
const project = (p: Point, origin: Point, direction: Point) =>
  (p[0] - origin[0]) * direction[0] + (p[1] - origin[1]) * direction[1];
const contains = (p: Point, polygon: Point[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
};
const boundaryDistance = (p: Point, polygon: Point[]) =>
  Math.min(
    ...polygon.map((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const u = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
            Math.max(0.001, dx * dx + dy * dy),
        ),
      );
      return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
    }),
  );

/** Source regions compile separate topology without altering the original image or UV. */
export function skinAuthoredPart(
  part: RigPart,
  pose: AuthoredPoseGeometry,
  name?: PoseName,
): RigPart {
  const source = { ...part, grid: [64, 64] };
  const explicit = names.find((name) => pose.limbs[name].part === part.id);
  // A complete held drawing only receives bounded inertial swing. Keep its
  // source surface connected: split topology would open opaque coat/trouser
  // boundaries without independently painted underlap. Large contact-driven
  // motions continue to use separate regions; this is not their repair path.
  const connectedHeld = name === "held" && !explicit;
  const mesh =
    explicit || connectedHeld
      ? gridMesh(source)
      : buildRegionMesh(
          source,
          names
            .filter(
              (name) => !pose.limbs[name].part && !pose.limbs[name].segments,
            )
            .map((id) => ({ id, polygon: pose.limbs[id].region })),
        );
  if (explicit) mesh.owners.fill(explicit);
  if (connectedHeld) {
    for (let vertex = 0; vertex < mesh.owners.length; vertex++) {
      const point: Point = [
        mesh.positions[vertex * 2],
        mesh.positions[vertex * 2 + 1],
      ];
      mesh.owners[vertex] =
        names.find(
          (key) =>
            !pose.limbs[key].part &&
            !pose.limbs[key].segments &&
            contains(point, pose.limbs[key].region),
        ) ?? null;
    }
  }
  const skin = names.flatMap((name) =>
    [name, `${name}Lower`, `${name}End`].map((deformer) => ({
      deformer,
      weights: [] as number[],
    })),
  );
  for (let vertex = 0; vertex < mesh.owners.length; vertex++) {
    const p: Point = [
      mesh.positions[vertex * 2],
      mesh.positions[vertex * 2 + 1],
    ];
    const influences = connectedHeld
      ? names.map((key) => {
          const limb = pose.limbs[key];
          if (limb.part || limb.segments) return 0;
          return smooth(
            0.5 +
              ((contains(p, limb.region) ? 1 : -1) *
                boundaryDistance(p, limb.region)) /
                24,
          );
        })
      : [0, 0, 0, 0];
    const influenceSum = Math.max(
      1,
      influences.reduce((total, value) => total + value, 0),
    );
    for (let index = 0; index < names.length; index++) {
      const name = names[index],
        limb = pose.limbs[name];
      let upper = 0,
        lower = 0,
        end = 0;
      if (
        connectedHeld ? influences[index] > 0 : mesh.owners[vertex] === name
      ) {
        const upperAxis = axis(limb.root, limb.joint);
        const lowerAxis = axis(limb.joint, limb.end);
        const jointAxis = axis(
          [0, 0],
          [upperAxis[0] + lowerAxis[0], upperAxis[1] + lowerAxis[1]],
        );
        const span = Math.max(
          4,
          Math.min(
            24,
            Math.hypot(
              limb.joint[0] - limb.root[0],
              limb.joint[1] - limb.root[1],
            ) * 1.15,
            Math.hypot(
              limb.end[0] - limb.joint[0],
              limb.end[1] - limb.joint[1],
            ) * 1.15,
          ),
        );
        const knee = smooth(project(p, limb.joint, jointAxis) / span + 0.5);
        // Keep boots and palms rigid from the ankle/wrist onward; the gradual
        // transition belongs on the proximal side of that joint.
        const distal = smooth(project(p, limb.end, lowerAxis) / span + 1);
        const root = connectedHeld
          ? (influences[index] / influenceSum) *
            smooth(project(p, limb.root, upperAxis) / 8)
          : 1;
        upper = root * (1 - knee);
        lower = root * knee * (1 - distal);
        end = root * knee * distal;
      }
      skin[index * 3].weights.push(upper);
      skin[index * 3 + 1].weights.push(lower);
      skin[index * 3 + 2].weights.push(end);
    }
  }
  mesh.skin = skin;
  return { ...source, skin, mesh };
}
