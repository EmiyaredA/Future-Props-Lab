import { describe, expect, test } from "vitest";
import {
  humanPose,
  type HumanFrame,
} from "../src/features/desktop-pet/humanFigure";

const frame: HumanFrame = {
  t: 1,
  mode: "idle",
  face: "neutral",
  look: [0, 0],
  legs: [
    [114, 220, 114, 256],
    [144, 220, 144, 256],
  ],
  low: 0,
  swing: 0,
  sit: 0,
  blink: 0,
  eyeClose: 0,
  talk: 0,
  tilt: 0,
  lean: 0,
};

describe("human sprite motion targets", () => {
  test("walking swings arms against legs while keeping gaze within neck limits", () => {
    const pose = humanPose({
      ...frame,
      mode: "walk",
      look: [100, -100],
      legs: [
        [114, 220, 135, 250],
        [144, 220, 123, 250],
      ],
    });
    expect(pose.legAngles[0]).toBeLessThan(0);
    expect(pose.legAngles[1]).toBeGreaterThan(0);
    expect(pose.arms[0]).toBeGreaterThan(0);
    expect(pose.arms[1]).toBeLessThan(0);
    expect(pose.neck).toBe(18);
  });
  test("seated lower-body offset anchors the soles on the floor", () => {
    const pose = humanPose({ ...frame, mode: "sit", sit: 1, low: 29 });
    expect(182 + 56 + pose.bodyY).toBe(256);
    expect(pose.sit).toBe(1);
  });
  test("airborne and dragged hands lift without rotating grounded idle arms", () => {
    expect(humanPose(frame).arms[0]).toBe(0);
    expect(humanPose({ ...frame, mode: "air" }).arms[0]).toBeGreaterThan(30);
    expect(humanPose({ ...frame, mode: "drag" }).arms[0]).toBeGreaterThan(50);
  });
});
