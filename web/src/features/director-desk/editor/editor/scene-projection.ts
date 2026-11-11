import * as T from "three";
import { editorEntityVisible, workingElevation } from "../building/floors.ts";
import type { Project, Vec3 } from "../model.ts";

export function pointerRay(e: MouseEvent, rect: DOMRect, camera: T.Camera) {
  const mouse = new T.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    (-(e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new T.Raycaster();
  ray.layers.enable(1);
  ray.setFromCamera(mouse, camera);
  return ray;
}
function visibleInScene(object: T.Object3D) {
  for (let node: T.Object3D | null = object; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}

export function entityUnderRay(
  ray: T.Raycaster,
  models: ReadonlyMap<string, T.Group>,
) {
  const hit = ray
    .intersectObjects([...models.values()], true)
    .find(({ object }) => visibleInScene(object));
  return hit?.object.userData.entityId as string | undefined;
}

export function pathHandleUnderRay(ray: T.Raycaster, handles: T.Object3D[]) {
  return ray
    .intersectObjects(handles, false)
    .find(({ object }) => object.userData.pointIndex !== undefined)?.object
    .userData.pointIndex as number | undefined;
}

export function pathGroundPoint(
  ray: T.Raycaster,
  project: Project,
  models: ReadonlyMap<string, T.Group>,
  surfaceModeRoom: T.Group | undefined,
  selected: string,
): Vec3 | undefined {
  if (surfaceModeRoom) {
    const surfaces: T.Object3D[] = project.entities
      .filter(
        (item) =>
          item.kind === "prop" &&
          !item.light &&
          item.visible &&
          item.id !== selected,
      )
      .flatMap((item) => models.get(item.id) ?? []);
    if (project.room.enabled) surfaces.push(surfaceModeRoom);
    const surface = ray
      .intersectObjects(surfaces, true)
      .find(({ object }) => visibleInScene(object));
    if (surface) return surface.point.toArray() as Vec3;
  }
  const point = ray.ray.intersectPlane(
    new T.Plane(new T.Vector3(0, 1, 0), -workingElevation(project)),
    new T.Vector3(),
  );
  return point?.toArray() as Vec3 | undefined;
}

export function projectSceneLabels(
  project: Project,
  models: ReadonlyMap<string, T.Group>,
  camera: T.Camera,
  w: number,
  h: number,
) {
  return project.entities
    .filter(
      (e) =>
        editorEntityVisible(project, e) &&
        (e.kind === "actor" || e.kind === "camera"),
    )
    .map((e) => {
      const p = models
        .get(e.id)!
        .position.clone()
        .add(new T.Vector3(0, e.kind === "actor" ? e.height + 0.16 : 0.25, 0));
      p.project(camera);
      return {
        id: e.id,
        name: e.name.split(" · ")[0],
        color: e.color,
        x: (p.x * 0.5 + 0.5) * w,
        y: (-0.5 * p.y + 0.5) * h,
        visible:
          p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1,
      };
    });
}
