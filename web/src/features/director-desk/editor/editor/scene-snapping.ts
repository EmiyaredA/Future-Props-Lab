import * as T from "three";
import { editorEntityVisible } from "../building/floors.ts";
import type { Project, Vec3 } from "../model.ts";
import {
  findObjectSnap,
  objectBounds,
  type SnapBounds,
} from "./object-snapping.ts";

export function collectSnapTargets(
  project: Project,
  models: ReadonlyMap<string, T.Group>,
  walls: ReadonlyMap<string, T.Group>,
  room: T.Group,
  exclude: string,
) {
  const targets: SnapBounds[] = [];
  for (const entity of project.entities) {
    if (
      entity.id === exclude ||
      entity.kind !== "prop" ||
      entity.light ||
      !editorEntityVisible(project, entity)
    )
      continue;
    const root = models.get(entity.id);
    const bounds = root ? objectBounds(root, entity.id, entity.name) : null;
    if (bounds) targets.push(bounds);
  }
  if (project.room.enabled) {
    const names: Record<string, string> = {
      north: "北墙",
      south: "南墙",
      east: "东墙",
      west: "西墙",
      ceiling: "天花板",
    };
    for (const [side, wall] of walls) {
      if (project.editorView?.hideWalls) continue;
      const bounds = objectBounds(wall, "room-" + side, names[side]);
      if (bounds) targets.push(bounds);
    }
    const floor = room.children.find((o) => o instanceof T.Mesh);
    if (floor) {
      const bounds = objectBounds(floor, "room-floor", "房间地面");
      if (bounds) targets.push(bounds);
    }
  }
  return targets;
}

export function snapSceneObject(
  root: T.Group,
  entity: { id: string; name: string },
  position: Vec3,
  axes: string,
  placementSnap: number,
  targets: () => SnapBounds[],
) {
  const bounds = objectBounds(root, entity.id, entity.name);
  if (!bounds) return undefined;
  const delta = new T.Vector3(...position).sub(root.position);
  bounds.corners.forEach((p) => p.add(delta));
  const result = findObjectSnap(bounds, targets(), axes);
  const target = result?.target.name ?? "";
  if (result && result.offset.lengthSq() > 1e-12)
    return {
      target,
      position: new T.Vector3(...position).add(result.offset).toArray() as Vec3,
    };
  // Nearby object boundaries win over the grid. Otherwise retain grid behavior on active axes only.
  const grid = new T.Vector3(
    ...position.map((v, i) =>
      axes.includes("XYZ"[i]) && placementSnap
        ? Math.round(v / placementSnap) * placementSnap
        : v,
    ),
  );
  if (result) {
    const correction = grid.sub(new T.Vector3(...position));
    const normal = result.normal.clone();
    ["X", "Y", "Z"].forEach((axis, i) => {
      if (!axes.includes(axis)) normal.setComponent(i, 0);
    });
    if (normal.lengthSq() > 1e-8)
      correction.addScaledVector(
        normal,
        -correction.dot(result.normal) / normal.lengthSq(),
      );
    return {
      target,
      position: new T.Vector3(...position).add(correction).toArray() as Vec3,
    };
  }
  return { target, position: grid.toArray() as Vec3 };
}
