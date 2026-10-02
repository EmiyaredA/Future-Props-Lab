import * as T from "three";
import type { Entity } from "../model.ts";
import { humanShape } from "./human-parameters.ts";
import { makeHuman as makeLegacyHuman, type Rig } from "./human-legacy.ts";
import { material, sphere, cylinder, box } from "./geometry.ts";
import { addHumanDetails } from "./human-details.ts";
import { addHumanCostume } from "./human-costume.ts";

export function makeHuman(e: Entity): Rig {
  const shape = humanShape(e);
  if (!shape) return makeLegacyHuman(e);
  const p = shape.proportions;
  const root = new T.Group(),
    hips = new T.Group();
  root.add(hips);
  const skin = material(e.color),
    jointSkin = material(new T.Color(e.color).multiplyScalar(0.91));
  const joints: Record<string, T.Group> = {};
  function joint(
    name: string,
    parent: T.Object3D,
    x: number,
    y: number,
    z = 0,
  ) {
    const g = new T.Group();
    g.position.set(x, y, z);
    parent.add(g);
    joints[name] = g;
    return g;
  }
  const restHipHeight = p.thigh + p.shin + 0.037;
  hips.position.y = restHipHeight;
  sphere(hips, skin, 0, 0.02, 0, p.pelvis * 1.6, 0.12, 0.105 * p.girth);
  const torso = joint("torso", hips, 0, 0.08);
  if (p.form !== "skeleton") {
    sphere(
      torso,
      skin,
      0,
      p.torso * 0.27,
      0,
      p.shoulder * 0.7,
      p.torso * 0.38,
      0.1 * p.girth,
    );
    sphere(
      torso,
      skin,
      0,
      p.torso * 0.65,
      0,
      p.shoulder * 0.86,
      p.torso * 0.35,
      0.11 * p.girth,
    );
  }
  cylinder(torso, skin, 0.045, 0.055, 0.09, 0, p.torso + 0.02);
  const head = joint("head", torso, 0, p.torso + 0.055);
  sphere(head, skin, 0, p.head, 0, p.head * 0.64, p.head, p.head * 0.66);
  sphere(head, skin, 0, p.head * 0.76, p.head * 0.67, 0.018, 0.025, 0.026);
  for (const side of ["left", "right"]) {
    const sign = side === "left" ? -1 : 1;
    const arm = joint(`${side}Arm`, torso, sign * p.shoulder, p.torso * 0.78);
    sphere(arm, jointSkin, 0, 0, 0, 0.05 * Math.sqrt(p.girth));
    cylinder(
      arm,
      skin,
      0.054 * Math.sqrt(p.girth),
      0.037 * Math.sqrt(p.girth),
      p.upperArm,
      0,
      -p.upperArm / 2,
    );
    const elbow = joint(`${side}Elbow`, arm, 0, -p.upperArm);
    sphere(elbow, jointSkin, 0, 0, 0, 0.036 * Math.sqrt(p.girth));
    cylinder(
      elbow,
      skin,
      0.039 * Math.sqrt(p.girth),
      0.026,
      p.forearm,
      0,
      -p.forearm / 2,
    );
    sphere(elbow, skin, 0, -p.forearm - 0.045, 0.012, 0.033, 0.057, 0.025);
    const hip = joint(`${side}Hip`, hips, sign * p.pelvis, 0);
    cylinder(
      hip,
      skin,
      0.081 * Math.sqrt(p.girth),
      0.051,
      p.thigh,
      0,
      -p.thigh / 2,
    );
    const knee = joint(`${side}Knee`, hip, 0, -p.thigh);
    sphere(knee, jointSkin, 0, 0, 0, 0.05);
    cylinder(knee, skin, 0.052, 0.029, p.shin, 0, -p.shin / 2);
    const ankle = joint(`${side}Ankle`, knee, 0, -p.shin);
    box(ankle, skin, 0.095, 0.074, 0.22, 0, 0, 0.045, 0.025);
  }
  root.updateMatrixWorld(true);
  const referenceHeight = new T.Box3().setFromObject(root, true).max.y;
  const rig: Rig = {
    root,
    hips,
    joints,
    skin,
    jointSkin,
    head,
    referenceHeight,
    restHipHeight,
    headRestHeight: restHipHeight + 0.08 + p.torso + 0.055,
    legLengths: { upper: p.thigh, lower: p.shin },
  };
  addHumanDetails(rig, p);
  for (const outfit of shape.costumes)
    addHumanCostume(rig, { ...p, outfit }, shape.length, shape.thickness);
  scaleHuman(rig, e);
  return rig;
}

export function scaleHuman(rig: Rig, e: Entity) {
  const h = e.height / (rig.referenceHeight ?? 1.75);
  rig.root.scale.set(
    h *
      e.scale[0] *
      (e.build === "slim" ? 0.87 : e.build === "broad" ? 1.2 : 1),
    h * e.scale[1],
    h * e.scale[2],
  );
}
export function colorHuman(rig: Rig, color: string) {
  rig.skin.color.set(color);
  rig.jointSkin?.color.set(color).multiplyScalar(0.91);
}
