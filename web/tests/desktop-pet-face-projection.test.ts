import { describe, expect, test } from "vitest";
import {
  paintHumanFace,
  type HumanFaceFrame,
} from "../src/features/desktop-pet/humanFace";
import type { AuthoredPose } from "../src/features/desktop-pet/locomotion/authoredPose";

const frame: HumanFaceFrame = {
  t: 1,
  mode: "held",
  face: "neutral",
  look: [0, 0],
  blink: 0,
  eyeClose: 0,
  talk: 0,
};
const layout = {
  view: [0, 0, 256, 256],
  feat: {
    sprites: {
      eyes: [98.215, 85.985, 162.595, 111.7],
      angry_eyes: [98.215, 85.985, 162.595, 111.7],
      surprised_eyes: [98.215, 85.985, 162.595, 111.7],
      closed_eyes: [98.215, 100.6, 162.595, 103.745],
    },
  },
};
const face: AuthoredPose["face"] = {
  eye: [150, 80, 14.667, 19.5],
  brow: [150, 78, 15, 2],
  mouth: [160, 104, 3, 1],
  twoEyes: false,
  angle: 10,
  clip: [
    [140, 60],
    [180, 60],
    [180, 120],
    [140, 120],
  ],
  sprites: {
    eyes: "profile_eye",
    angry_eyes: "profile_angry",
    surprised_eyes: "profile_surprised",
    closed_eyes: "profile_closed",
  },
};
function image(width: number, height: number) {
  const result = new Image();
  Object.defineProperties(result, {
    width: { value: width },
    height: { value: height },
  });
  return result;
}
function surface() {
  const calls: { op: string; args: unknown[] }[] = [];
  const context = new Proxy(
    {},
    {
      get:
        (_, key) =>
        (...args: unknown[]) => {
          calls.push({ op: String(key), args });
        },
    },
  ) as CanvasRenderingContext2D;
  return { calls, context, canvas: document.createElement("canvas") };
}
const images = {
  eyes: image(348, 139),
  angry_eyes: image(348, 139),
  surprised_eyes: image(348, 139),
  closed_eyes: image(348, 17),
  profile_eye: image(127, 102),
  profile_angry: image(220, 168),
  profile_surprised: image(201, 207),
  profile_closed: image(207, 65),
};

describe("real human face canvas projection", () => {
  test.each([
    ["neutral", "profile_eye"],
    ["angry", "profile_angry"],
    ["surprised", "profile_surprised"],
  ] as const)(
    "%s preserves the painted eye aspect inside the hair mask",
    (expression, key) => {
      const { calls, context, canvas } = surface();
      paintHumanFace(
        context,
        canvas,
        layout,
        images,
        { ...frame, face: expression },
        0,
        0,
        face,
      );
      const draw = calls.find((c) => c.op === "drawImage")!.args;
      expect(draw[0]).toBe(images[key]);
      const width = Number(draw[7]),
        height = Number(draw[8]);
      expect(width / images[key].width).toBeCloseTo(
        height / images[key].height,
        12,
      );
      expect(Number(draw[5]) + width / 2).toBeCloseTo(
        face.eye[0] + face.eye[2] / 2,
        12,
      );
      expect(calls.findIndex((c) => c.op === "clip")).toBeLessThan(
        calls.findIndex((c) => c.op === "rotate"),
      );
      expect(calls.filter((c) => c.op === "lineTo").map((c) => c.args)).toEqual(
        face.clip!.slice(1),
      );
    },
  );
  test("blink changes openness without a second horizontal squeeze", () => {
    const { calls, context, canvas } = surface();
    paintHumanFace(
      context,
      canvas,
      layout,
      images,
      { ...frame, blink: 0.5 },
      0,
      0,
      face,
    );
    const draw = calls.find((c) => c.op === "drawImage")!.args;
    expect(draw[7]).toBeCloseTo((19.5 * 127) / 102, 10);
    expect(draw[8]).toBe(19.5 * 0.5);
  });
  test("closed eye retains the registered lash width and three-unit stroke", () => {
    const { calls, context, canvas } = surface();
    paintHumanFace(
      context,
      canvas,
      layout,
      images,
      { ...frame, blink: 1 },
      0,
      0,
      face,
    );
    const draw = calls.find((c) => c.op === "drawImage")!.args;
    expect(draw[0]).toBe(images.profile_closed);
    expect(draw[7]).toBe(face.eye[2]);
    expect(draw[8]).toBe(3);
  });
  test("original standing features retain their registered two-eye rectangle", () => {
    const { calls, context, canvas } = surface();
    paintHumanFace(context, canvas, layout, images, frame, 0);
    const draw = calls.find((c) => c.op === "drawImage")!.args;
    expect(draw.slice(0, 3)).toEqual([images.eyes, 98.215, 85.985]);
    expect(draw[3]).toBeCloseTo(64.38, 12);
    expect(draw[4]).toBeCloseTo(25.715, 12);
    expect(calls.some((c) => c.op === "clip")).toBe(false);
  });
  test("whole-pose eye crop keeps its source pixels, aspect and blink width", () => {
    const source = image(1182, 1330);
    const crop: [number, number, number, number] = [575, 430, 230, 90];
    for (const blink of [0, 0.5]) {
      const { calls, context, canvas } = surface();
      paintHumanFace(
        context,
        canvas,
        layout,
        { ...images, whole: source },
        { ...frame, blink },
        0,
        0,
        {
          ...face,
          twoEyes: true,
          sprites: { ...face.sprites, eyes: "whole" },
          sourceRects: { eyes: crop },
        },
      );
      const draw = calls.find((c) => c.op === "drawImage")!.args;
      expect(draw.slice(0, 5)).toEqual([source, ...crop]);
      expect(Number(draw[7]) / crop[2]).toBeCloseTo(face.eye[3] / crop[3], 12);
      expect(draw[8]).toBe(face.eye[3] * (1 - blink));
      expect(Number(draw[5]) + Number(draw[7]) / 2).toBeCloseTo(
        face.eye[0] + face.eye[2] / 2,
        12,
      );
    }
  });
});
