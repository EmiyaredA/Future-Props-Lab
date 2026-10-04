import { expect, test } from "vitest";
import fixture from "./fixtures/desktop-pet-motion-v2.json";
import {
  posePartIds,
  type AuthoredPoses,
} from "../src/features/desktop-pet/locomotion/authoredPose";
import { readAuthoredTransitions } from "../src/features/desktop-pet/locomotion/motionTransitions";

test.each(["left", "right", "top", "bottom"] as const)(
  "%s supports must share a plane even when each matches its own geometry",
  (edge) => {
    const poses = structuredClone(fixture.poses) as AuthoredPoses;
    const name = edge === "left" || edge === "right" ? "side" : edge;
    const pair =
      edge === "bottom"
        ? (["legBack", "legFront"] as const)
        : (["armNear", "armFar"] as const);
    const axis = edge === "left" || edge === "right" ? 0 : 1;
    const transition = {
      id: "same-edge",
      from: { pose: name, facing: 1, edge },
      to: { pose: name, facing: -1, edge },
      durationMs: 250,
      keyframes: [0, 1].map((progress) => ({
        progress,
        pose: name,
        viewFacing: 1,
        supports: Object.fromEntries(
          pair.map((limb) => [limb, { edge, point: [110, 195] }]),
        ),
      })),
    };
    for (const limb of pair) poses[name].limbs[limb].contact = [110, 195];
    const read = () =>
      readAuthoredTransitions(
        [transition],
        poses,
        () => {
          throw new Error("No inline views in this fixture");
        },
        posePartIds,
      );
    expect(read()).toHaveLength(1);
    for (const distance of [1, 1.01, 2]) {
      const point: [number, number] = [110, 195];
      point[axis] += distance;
      poses[name].limbs[pair[1]].contact = point;
      for (const frame of transition.keyframes)
        frame.supports[pair[1]].point = [...point];
      if (distance <= 1) expect(read()).toHaveLength(1);
      else expect(read).toThrow();
    }
  },
);
