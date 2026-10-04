import { expect, test } from "vitest";
import {
  readFrameSequences,
  validateSequenceImages,
} from "../src/features/desktop-pet/sequences/validation";
import type {
  FrameSequences,
  SequenceFrame,
} from "../src/features/desktop-pet/sequences/types";

function source(): FrameSequences {
  const frame: SequenceFrame = {
    texture: "sequence_atlas",
    rect: [0, 0, 16, 16],
    durationMs: 40,
    grip: [8, 8],
    foot: [8, 16],
    head: [
      [8, 0],
      [8, 6],
    ],
  };
  return {
    version: 1,
    frameSize: [16, 16],
    modelBox: [-16, 0, 32, 32],
    headLength: 12,
    clips: {
      idle: { frames: [frame], loop: true },
      walk: {
        frames: [{ ...structuredClone(frame), rect: [16, 0, 16, 16] }],
        loop: true,
        distancePerCycle: 32,
      },
      start: { frames: [structuredClone(frame)], loop: false },
    },
    transitions: [{ id: "idle-walk", from: "idle", to: "walk", clip: "start" }],
  };
}
function badFrame(fields: Record<string, unknown>) {
  const value = source();
  return {
    ...value,
    clips: {
      ...value.clips,
      idle: {
        ...value.clips.idle,
        frames: [{ ...value.clips.idle.frames[0], ...fields }],
      },
    },
  };
}

test("reader returns owned complete metadata at one global scale; absent and invalid differ", () => {
  const value = source();
  const parsed = readFrameSequences(value)!;
  expect(parsed).toEqual(value);
  value.clips.idle.frames[0].grip[0] = 1;
  value.clips.idle.frames[0].head[1][1] = 10;
  expect(parsed.clips.idle.frames[0].grip).toEqual([8, 8]);
  expect(parsed.clips.idle.frames[0].head).toEqual([
    [8, 0],
    [8, 6],
  ]);
  expect(readFrameSequences(undefined)).toBeNull();
  expect(() => readFrameSequences(null)).toThrow();
});

test.each([
  ["version", true],
  ["version", 2],
  ["frameSize", [16.5, 16]],
  ["frameSize", [0, 16]],
  ["modelBox", [0, 0, 32, 30]],
  ["modelBox", [0, 0, Infinity, 32]],
  ["headLength", 0],
  ["headLength", NaN],
  ["scale", 2],
  ["transitions", null],
  ["transitions", {}],
])("strict namespace rejects %s=%j", (key, value) => {
  expect(() =>
    readFrameSequences({ ...source(), [String(key)]: value }),
  ).toThrow();
});

test.each([
  { texture: "../outside" },
  { texture: "https://outside" },
  { rect: [0, 0, 15, 16] },
  { rect: [0.1, 0, 16, 16] },
  { rect: [-1, 0, 16, 16] },
  { durationMs: 0 },
  { durationMs: 60001 },
  { durationMs: Infinity },
  { durationMs: true },
  { grip: [-1, 8] },
  { foot: [8, 17] },
  {
    head: [
      [8, 0],
      [8, 8],
    ],
  },
  {
    head: [
      [8, 0],
      [8, 0],
    ],
  },
  {
    head: [
      [8, 0],
      [8, 16.1],
    ],
  },
  { box: [0, 0, 32, 32] },
  { scale: 1 },
  { contacts: { middle: [8, 8] } },
  { contacts: { top: [17, 0] } },
  { supports: { neck: [8, 8] } },
  { supports: { armNear: [8, -1] } },
])("frame layout, local bounds and fixed head marker reject %j", (fields) => {
  expect(() => readFrameSequences(badFrame(fields))).toThrow();
});

test("idle and explicit transition array are mandatory; no implicit hard cut is inferred", () => {
  const value = source();
  const withoutIdle = structuredClone(value.clips);
  delete withoutIdle.idle;
  expect(() => readFrameSequences({ ...value, clips: withoutIdle })).toThrow();
  const withoutTransitions: Partial<FrameSequences> = structuredClone(value);
  delete withoutTransitions.transitions;
  expect(() => readFrameSequences(withoutTransitions)).toThrow();
  expect(
    readFrameSequences({ ...value, transitions: [] })?.transitions,
  ).toEqual([]);
});

const invalidTransitions = [
  [{ id: "bad", from: "idle", to: "missing", clip: "start" }],
  [{ id: "bad", from: "missing", to: "walk", clip: "start" }],
  [{ id: "bad", from: "idle", to: "walk", clip: "missing" }],
  [{ id: "bad", from: "idle", to: "walk", clip: "start", hardCut: true }],
  [
    { id: "same", from: "idle", to: "walk", clip: "start" },
    { id: "same", from: "walk", to: "idle", clip: "start" },
  ],
  [
    { id: "first", from: "idle", to: "walk", clip: "start" },
    { id: "second", from: "idle", to: "walk", clip: "start" },
  ],
];
test.each(invalidTransitions.map((transitions) => ({ transitions })))(
  "transitions require existing clips and unique IDs/from-to pairs %j",
  ({ transitions }) => {
    expect(() => readFrameSequences({ ...source(), transitions })).toThrow();
  },
);

test("provided contacts and supports retain local coordinates without claiming edge capabilities", () => {
  const value = source();
  value.clips.idle.frames[0].contacts = { top: [8, 0], bottom: [8, 16] };
  value.clips.idle.frames[0].supports = { armNear: [8, 0], legBack: [8, 16] };
  const parsed = readFrameSequences(value)!;
  expect(parsed.clips.idle.frames[0].contacts).toEqual(
    value.clips.idle.frames[0].contacts,
  );
  expect(Object.keys(parsed.clips)).toEqual(["idle", "walk", "start"]);
});

test.each([5.88, 6.12])(
  "head marker accepts inclusive two percent bound %d",
  (end) => {
    const value = source();
    value.clips.idle.frames[0].head[1][1] = end;
    expect(readFrameSequences(value)?.headLength).toBe(12);
  },
);

test("actual image closure and frame rect bounds are checked after decode for each outfit", () => {
  const parsed = readFrameSequences(source())!;
  const invalidImages: Record<string, { width: number; height: number }>[] = [
    {},
    { sequence_atlas: { width: 16, height: 16 } },
    { sequence_atlas: { width: Infinity, height: 16 } },
    { sequence_atlas: { width: 32, height: 15 } },
  ];
  for (const dimensions of invalidImages)
    expect(() => validateSequenceImages(parsed, dimensions)).toThrow();
  expect(() =>
    validateSequenceImages(parsed, {
      sequence_atlas: { width: 32, height: 16 },
    }),
  ).not.toThrow();
});

test("global isotope tolerance is bounded and no per-frame fitting is introduced", () => {
  const value = source();
  value.modelBox[3] = 32 * (1 + 5e-7);
  expect(readFrameSequences(value)?.modelBox[3]).toBe(value.modelBox[3]);
  value.modelBox[3] = 32 * (1 + 2e-6);
  expect(() => readFrameSequences(value)).toThrow("禁止各向异性缩放");
});

test.each(["clips", "frames", "total", "transitions"])(
  "bounded description rejects excess %s",
  (kind) => {
    const value = source();
    const clip = value.clips.idle;
    if (kind === "clips")
      for (let n = 0; n < 64; n++)
        value.clips[`clip_${n}`] = structuredClone(clip);
    else if (kind === "frames")
      clip.frames = Array.from({ length: 129 }, () =>
        structuredClone(clip.frames[0]),
      );
    else if (kind === "total") {
      clip.frames = Array.from({ length: 128 }, () =>
        structuredClone(clip.frames[0]),
      );
      value.clips = {
        idle: clip,
        ...Object.fromEntries(
          Array.from({ length: 16 }, (_, n) => [
            `clip_${n}`,
            structuredClone(clip),
          ]),
        ),
      };
    } else
      value.transitions = Array.from({ length: 129 }, () =>
        structuredClone(value.transitions[0]),
      );
    expect(() => readFrameSequences(value)).toThrow();
  },
);

test("safe IDs are held as own properties, including JavaScript dictionary edge names", () => {
  const value = source();
  Object.defineProperty(value.clips, "__proto__", {
    value: structuredClone(value.clips.idle),
    enumerable: true,
  });
  const parsed = readFrameSequences(value)!;
  expect(Object.hasOwn(parsed.clips, "__proto__")).toBe(true);
  expect(parsed.clips.__proto__.frames[0].texture).toBe("sequence_atlas");
});
