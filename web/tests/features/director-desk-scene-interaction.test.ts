import * as T from "three";
import { expect, it } from "vitest";
import { entityUnderRay } from "@features/director-desk/editor/editor/scene-projection";
import { snapSceneObject } from "@features/director-desk/editor/editor/scene-snapping";
import { objectBounds } from "@features/director-desk/editor/editor/object-snapping";

function cube(id: string, position: [number, number, number]) {
  const root = new T.Group();
  const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  mesh.userData.entityId = id;
  root.add(mesh);
  root.position.set(...position);
  root.updateMatrixWorld(true);
  return root;
}

it("picks the nearest visible entity through a hidden parent", () => {
  const hidden = cube("hidden", [0, 0, 2]);
  hidden.visible = false;
  const visible = cube("visible", [0, 0, 0]);
  const ray = new T.Raycaster(new T.Vector3(0, 0, 5), new T.Vector3(0, 0, -1));
  expect(
    entityUnderRay(
      ray,
      new Map([
        ["hidden", hidden],
        ["visible", visible],
      ]),
    ),
  ).toBe("visible");
});

it("snaps against a nearby object's boundary ahead of the placement grid", () => {
  const moving = cube("moving", [0, 0, 0]);
  const target = cube("target", [2.3, 0, 0]);
  const bounds = objectBounds(target, "target", "target")!;
  const result = snapSceneObject(
    moving,
    { id: "moving", name: "moving" },
    [1.25, 0, 0],
    "X",
    0.5,
    () => [bounds],
  );
  expect(result?.target).toBe("target");
  expect(result?.position[0]).toBeCloseTo(1.3);
});
