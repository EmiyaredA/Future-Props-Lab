// Preserve original mannequin geometry for existing projects.
import * as T from "three";
import type { Entity } from "../model.ts";
import { material, sphere, cylinder, box } from "./geometry.ts";
export interface Rig {
  poseAxes?: Record<string, "x" | "y" | "z">;
  poseSigns?: Record<string, number>;
  root: T.Group;
  hips: T.Group;
  joints: Record<string, T.Group>;
  skin: T.MeshStandardMaterial;
  head: T.Group;
  referenceHeight?: number;
  restHipHeight?: number;
  headRestHeight?: number;
  legLengths?: { upper: number; lower: number };
  jointSkin?: T.MeshStandardMaterial;
}
export function makeHuman(e: Entity): Rig {
  const root = new T.Group(),
    hips = new T.Group();
  root.add(hips);
  hips.position.y = 0.94;
  const skin = material(e.color),
    jointMat = material(new T.Color(e.color).multiplyScalar(0.91));
  const joints: Record<string, T.Group> = {};
  const makeJoint = (
    name: string,
    parent: T.Object3D,
    x: number,
    y: number,
    z = 0,
  ) => {
    const g = new T.Group();
    g.position.set(x, y, z);
    parent.add(g);
    joints[name] = g;
    return g;
  };
  sphere(hips, skin, 0, 0, 0, 0.155, 0.12, 0.112);
  const torso = makeJoint("torso", hips, 0, 0.1);
  sphere(torso, skin, 0, 0.105, 0, 0.133, 0.19, 0.092);
  sphere(
    torso,
    skin,
    0,
    0.255,
    0,
    e.gender === "female" ? 0.157 : 0.174,
    0.18,
    0.106,
  );
  const neck = cylinder(torso, skin, 0.046, 0.058, 0.12, 0, 0.432);
  neck.castShadow = true;
  const head = makeJoint("head", torso, 0, 0.49);
  sphere(head, skin, 0, 0.105, 0.006, 0.095, 0.115, 0.094);
  sphere(head, skin, 0, 0.045, 0.028, 0.077, 0.055, 0.076);
  // A small nose establishes facing direction without facial expression detail.
  sphere(head, skin, 0, 0.084, 0.096, 0.018, 0.026, 0.025);
  for (const side of ["left", "right"]) {
    const sign = side === "left" ? -1 : 1;
    const arm = makeJoint(
      `${side}Arm`,
      torso,
      sign * (e.gender === "female" ? 0.165 : 0.188),
      0.31,
    );
    sphere(arm, jointMat, 0, 0, 0, 0.058);
    const upper = cylinder(arm, skin, 0.057, 0.039, 0.26, 0, -0.135);
    upper.rotation.z = sign * 0.04;
    const elbow = makeJoint(`${side}Elbow`, arm, 0, -0.285);
    sphere(elbow, jointMat, 0, 0, 0, 0.039);
    cylinder(elbow, skin, 0.041, 0.027, 0.225, 0, -0.116);
    sphere(elbow, skin, 0, -0.277, 0.01, 0.033, 0.065, 0.023);
    const hip = makeJoint(`${side}Hip`, hips, sign * 0.09, -0.015);
    cylinder(hip, skin, 0.085, 0.057, 0.37, 0, -0.21);
    sphere(hip, skin, 0, -0.04, 0, 0.078, 0.11, 0.079);
    const knee = makeJoint(`${side}Knee`, hip, 0, -0.43);
    sphere(knee, jointMat, 0, 0, 0, 0.052);
    cylinder(knee, skin, 0.06, 0.032, 0.405, 0, -0.215);
    sphere(knee, skin, 0, -0.16, -0.012, 0.055, 0.14, 0.057);
    sphere(knee, skin, 0, -0.424, 0, 0.028, 0.03, 0.029);
    const ankle = makeJoint(`${side}Ankle`, knee, 0, -0.458);
    box(ankle, skin, 0.095, 0.074, 0.22, 0, 0, 0.05, 0.03);
  }
  scaleLegacyHuman(root, e);
  return { root, hips, joints, skin, head, jointSkin: jointMat };
}
export function scaleLegacyHuman(
  root: T.Group,
  e: Pick<Entity, "height" | "build">,
) {
  const build = e.build === "slim" ? 0.87 : e.build === "broad" ? 1.2 : 1;
  root.scale.set((e.height / 1.75) * build, e.height / 1.75, e.height / 1.75);
}
