import {
  createHumanFigure,
  type HumanModel,
} from "@features/desktop-pet/humanFigure";
import authoredFixture from "./fixtures/desktop-pet-motion-v2.json";
import type { AuthoredPoses } from "@features/desktop-pet/locomotion/authoredPose";
import { afterEach, expect, test, vi } from "vitest";
import { createPet } from "@features/desktop-pet/whale-vendor/pet-core.js";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import { readFrameSequences } from "@features/desktop-pet/sequences/validation";
import type {
  FrameSequences,
  SequencePoint,
} from "@features/desktop-pet/sequences/types";
import type { PetMotionFrame } from "@platform/petMotion";
import type { LoadedWhaleFigure } from "@features/desktop-pet/whale-vendor/whale/figure.js";

const NS = "http://www.w3.org/2000/svg";
const grips: SequencePoint[] = [
  [128, 188],
  [148, 168],
  [168, 148],
];
const pack = (withHeld = true) => {
  const frames = grips.map((grip, i) => ({
    texture: i === 0 ? "idle" : "held",
    rect: [i * 256, 0, 256, 512],
    durationMs: 100,
    grip,
    foot: [140, 500],
    head: [
      [128, 10],
      [128, 110],
    ],
  }));
  return readFrameSequences({
    version: 1,
    frameSize: [256, 512],
    modelBox: [0, 0, 256, 512],
    headLength: 100,
    clips: {
      idle: { loop: true, frames: [frames[0]] },
      ...(withHeld
        ? {
            held: { loop: true, frames: [frames[2]] },
            pickup: { loop: false, frames },
            release: { loop: false, frames: [...frames].reverse() },
          }
        : {}),
    },
    transitions: withHeld
      ? [
          { id: "pickup", from: "idle", to: "held", clip: "pickup" },
          { id: "release", from: "held", to: "idle", clip: "release" },
        ]
      : [],
  })!;
};
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function matrix(group: SVGGElement) {
  const raw = group.getAttribute("transform")!;
  const values = (kind: string) =>
    raw
      .match(new RegExp(kind + "\\(([^)]+)\\)"))![1]
      .split(" ")
      .map(Number);
  const [x, y] = values("translate"),
    [sx, sy] = values("scale");
  const angle = (values("rotate")[0] * Math.PI) / 180;
  const tail = raw
    .match(/translate\(([^)]+)\)$/)![1]
    .split(" ")
    .map(Number);
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    a: sx * c,
    b: sx * s,
    c: -sy * s,
    d: sy * c,
    e: x + tail[0] * sx * c - tail[1] * sy * s,
    f: y + tail[0] * sx * s + tail[1] * sy * c,
  };
}
function setup(scale: number, withHeld = true, sequences = pack(withHeld)) {
  let resolve: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  let pending: Promise<void> | null = null;
  const requests: string[] = [];
  class TestImage {
    src = "";
    naturalWidth = 768;
    naturalHeight = 512;
    async decode() {
      requests.push(this.src);
      if (this.src.endsWith("held.png")) await pending;
    }
  }
  vi.stubGlobal("Image", TestImage);
  const drawImage = vi.fn();
  const context = {
    clearRect: vi.fn(),
    drawImage,
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => context) as unknown as HTMLCanvasElement["getContext"],
  );
  const base: LoadedWhaleFigure = {
    fixedScale: true,
    scheme: "classic",
    motionFacing: () => 1,
    pickupPoint: () => [128, 188],
    preload: async () => undefined,
    draw: () => undefined,
    setScheme: () => undefined,
    reset: () => undefined,
  };
  const figure = createSequenceFigure({
    base,
    sequences,
    scheme: "classic",
    defaultScheme: "classic",
    asset: (path) => `/authorized/${path}`,
  });
  const group = document.createElementNS(NS, "g");
  const viewport = { x: -1142.25, y: 468.5 };
  Object.defineProperty(group, "getScreenCTM", { value: () => matrix(group) });
  const pet = createPet(
    {
      petG: group,
      shadowEl: document.createElementNS(NS, "ellipse"),
      fxG: document.createElementNS(NS, "g"),
    },
    {
      figure,
      roam: "off",
      walkInPlace: true,
      startX: 180,
      sfx: new Proxy({}, { get: () => () => undefined }),
      viewportOrigin: () => viewport,
      bounds: () => ({ W: 400, H: 600, floorY: 560, S: scale }),
    },
  );
  const local = (point: SequencePoint): SequencePoint => {
    const m = matrix(group);
    return [
      m.a * point[0] + m.c * point[1] + m.e,
      m.b * point[0] + m.d * point[1] + m.f,
    ];
  };
  const current = () => {
    const args = drawImage.mock.calls.at(-1)! as [TestImage, ...number[]];
    const cell = args[1] / 256;
    const object = group.querySelector("foreignObject")!;
    const box = ["x", "y", "width", "height"].map((key) =>
      Number(object.getAttribute(key)),
    );
    const model: SequencePoint = [
      box[0] + (grips[cell][0] * box[2]) / 256,
      box[1] + (grips[cell][1] * box[3]) / 512,
    ];
    const point = local(model);
    return {
      cell,
      box,
      model,
      world: [viewport.x + point[0], viewport.y + point[1]] as SequencePoint,
    };
  };
  const held = (point: SequencePoint): PetMotionFrame => ({
    state: "held",
    facing: 1,
    edge: null,
    phase: 0,
    velocity: { x: 0, y: 0 },
    swing: 0,
    grip: { x: point[0], y: point[1] },
  });
  const grab = (offset: SequencePoint) => {
    const now = current();
    const point = local([now.model[0] + offset[0], now.model[1] + offset[1]]);
    pet.setLocomotion(held(point));
    pet.render();
    return [viewport.x + point[0], viewport.y + point[1]] as SequencePoint;
  };
  const advance = (seconds: number) => {
    const n = Math.ceil(seconds / 0.02);
    for (let i = 0; i < n; i++) {
      pet.step(seconds / n);
      pet.render();
    }
  };
  return {
    drawImage,
    figure,
    pet,
    group,
    current,
    grab,
    advance,
    requests,
    viewport,
    wait: () => {
      pending = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
    },
    resolve: () => resolve!(),
    reject: () => reject!(new Error("actual-held-decode-failure")),
  };
}
const closePoint = (actual: SequencePoint, expected: SequencePoint) =>
  expect(
    Math.hypot(actual[0] - expected[0], actual[1] - expected[1]),
  ).toBeLessThan(0.11);

function hover(stage: ReturnType<typeof setup>) {
  const waist = stage.current().world;
  stage.pet.pointerMove({
    x: waist[0] - stage.viewport.x - 110,
    y: waist[1] - stage.viewport.y - 60,
  });
}
for (const scale of [0.7933, 1.2735]) {
  test(`whole original stays full width across 100 public hover steps and first held paint at ${scale}`, async () => {
    const stage = setup(scale);
    await stage.figure.preload();
    stage.pet.render();
    hover(stage);
    for (let i = 0; i < 100; i++) {
      stage.pet.step(1 / 60);
      stage.pet.render();
      const m = matrix(stage.group);
      expect(m.a).toBe(scale);
      expect(Math.abs(m.b)).toBe(0);
      expect(stage.current().cell).toBe(0);
    }
    const before = stage.current();
    stage.grab([24, -60]);
    closePoint(stage.current().world, before.world);
    stage.pet.step(1 / 60);
    stage.pet.render();
    expect(stage.current().cell).toBe(0);
    // The first render inside grab is at t=0; the following native-style step
    // begins the legitimate 220ms pickup ease, never a source-image mirror.
    expect(Math.abs(stage.current().world[0] - before.world[0])).toBeLessThan(
      1,
    );
    expect(Math.abs(stage.current().world[1] - before.world[1])).toBeLessThan(
      2,
    );
    expect(matrix(stage.group).a).toBe(scale);
    stage.figure.dispose?.();
  });
}
function physicalPack(): FrameSequences {
  const source = pack();
  const idle = {
    ...source.clips.idle.frames[0],
    supports: { legFront: [140, 500] as SequencePoint },
  };
  const cel = (texture: string, index: number) => ({
    ...idle,
    texture,
    rect: [index * 256, 0, 256, 512] as [number, number, number, number],
  });
  const left = cel("left", 1),
    right = cel("right", 2);
  return {
    ...source,
    clips: {
      idle: { loop: true, frames: [idle] },
      "walk-left": { loop: true, distancePerCycle: 60, frames: [left] },
      "walk-right": { loop: true, distancePerCycle: 60, frames: [right] },
      "start-left": { loop: false, frames: [idle, left] },
      "start-right": { loop: false, frames: [idle, right] },
    },
    transitions: [
      { id: "left-entry", from: "idle", to: "walk-left", clip: "start-left" },
      {
        id: "right-entry",
        from: "idle",
        to: "walk-right",
        clip: "start-right",
      },
    ],
  };
}
for (const facing of [-1, 1] as const) {
  test(`physical ${facing < 0 ? "left" : "right"} selects distinct whole source art without whole mirroring`, async () => {
    const stage = setup(0.7933, true, physicalPack());
    await stage.figure.preload();
    stage.pet.render();
    const motion: PetMotionFrame = {
      state: "walk",
      facing,
      edge: null,
      phase: 0,
      velocity: { x: 60 * facing, y: 0 },
      swing: 0,
      travel: { x: 0, y: 0 },
    };
    stage.pet.setLocomotion(motion);
    stage.pet.step(1 / 60);
    stage.pet.render();
    await settle();
    stage.advance(0.4);
    expect(stage.current().cell).toBe(facing < 0 ? 1 : 2);
    expect(stage.drawImage.mock.calls.at(-1)![0].src).toMatch(
      facing < 0 ? /left\.png$/ : /right\.png$/,
    );
    expect(matrix(stage.group).a).toBe(0.7933);
    expect(stage.figure.getMotionFailure?.()).toBeNull();
    stage.figure.dispose?.();
  });
}
test("fixed basis does not bypass missing physical source guards", async () => {
  const stage = setup(0.7933, false);
  await stage.figure.preload();
  stage.pet.render();
  stage.pet.setLocomotion({
    state: "walk",
    facing: -1,
    edge: null,
    phase: 0,
    velocity: { x: -60, y: 0 },
    swing: 0,
    travel: { x: 0, y: 0 },
  });
  stage.pet.step(1 / 60);
  stage.pet.render();
  expect(stage.current().cell).toBe(0);
  expect(matrix(stage.group).a).toBe(0.7933);
  expect(stage.figure.getMotionFailure?.()).toBe("sequence:missing-clip");
  stage.figure.dispose?.();
});
function defaultCore(groupFacing?: () => number) {
  const group = document.createElementNS(NS, "g");
  const figure = {
    fixedScale: true,
    groupTilt: () => 0,
    draw: () => undefined,
    ...(groupFacing ? { groupFacing } : {}),
  };
  const pet = createPet(
    {
      petG: group,
      shadowEl: document.createElementNS(NS, "ellipse"),
      fxG: document.createElementNS(NS, "g"),
    },
    {
      figure,
      roam: "off",
      walkInPlace: true,
      startX: 180,
      sfx: new Proxy({}, { get: () => () => undefined }),
      bounds: () => ({ W: 400, H: 600, floorY: 560, S: 0.7933 }),
    },
  );
  pet.render();
  pet.pointerMove({ x: 70, y: 430 });
  return { pet, group };
}
for (const basis of [undefined, -1, 1, 0, 0.4, NaN, Infinity, -Infinity]) {
  test(`initial public render honors only a valid fixed basis ${String(basis)}`, () => {
    const callback = basis === undefined ? undefined : vi.fn(() => basis);
    const { group } = defaultCore(callback);
    const expected = basis === -1 ? -1 : 1;
    // defaultCore renders before pointerMove, with no step beforehand.
    expect(matrix(group).a).toBe(0.7933 * expected);
    expect(matrix(group).d).toBe(0.7933);
    if (callback) expect(callback).toHaveBeenCalledTimes(1);
  });
}
test("initial fixed-basis callback errors are not silently swallowed", () => {
  const error = new Error("author basis unavailable");
  expect(() =>
    defaultCore(() => {
      throw error;
    }),
  ).toThrow(error);
});
for (const invalid of [undefined, 0, 0.4, NaN, Infinity]) {
  test(`old no-flag/invalid display basis ${String(invalid)} retains original hover behavior`, () => {
    const { pet, group } = defaultCore(
      invalid === undefined ? undefined : () => invalid,
    );
    const widths = [];
    for (let i = 0; i < 100; i++) {
      pet.step(1 / 60);
      pet.render();
      widths.push(matrix(group).a);
    }
    expect(Math.min(...widths.map(Math.abs))).toBeLessThan(0.1);
    expect(widths.at(-1)).toBeLessThan(0);
  });
}
for (const basis of [-1, 1]) {
  test(`valid fixed display basis ${basis} remains unit-sized for hover and requested physical direction`, () => {
    const { pet, group } = defaultCore(() => basis);
    for (let i = 0; i < 100; i++) {
      pet.step(1 / 60);
      pet.render();
      expect(matrix(group).a).toBe(0.7933 * basis);
    }
    pet.setLocomotion({
      state: "held",
      facing: -1,
      edge: null,
      phase: 0,
      velocity: { x: 0, y: 0 },
      swing: 0,
      grip: { x: 180, y: 350 },
    });
    pet.step(1 / 60);
    pet.render();
    expect(matrix(group).a).toBe(0.7933 * basis);
  });
}
function humanModel(version?: 1 | 2): HumanModel {
  const limbs: NonNullable<HumanModel["motionRig"]>["limbs"] = {
    armNear: {
      root: [40, 40],
      joint: [45, 50],
      end: [50, 65],
      parts: ["a", "b", "c"],
    },
    armFar: {
      root: [40, 40],
      joint: [45, 50],
      end: [50, 65],
      parts: ["d", "e", "f"],
    },
    legBack: {
      root: [40, 40],
      joint: [45, 50],
      end: [50, 65],
      parts: ["g", "h", "i"],
    },
    legFront: {
      root: [40, 40],
      joint: [45, 50],
      end: [50, 65],
      parts: ["j", "k", "l"],
    },
  };
  return {
    rigProfile: "human-chibi",
    character: { name: "basis-routing" },
    view: [0, 0, 100, 100],
    pivots: Object.fromEntries(
      ["body", "neck", "armNear", "armFar", "legBack", "legFront"].map((id) => [
        id,
        [50, 50],
      ]),
    ),
    parts: ["hair_back", "hair_front", "coat"].map((id, z) => ({
      id,
      tex: "atlas",
      parent: "body",
      box: [0, 0, 100, 100],
      grid: [1, 1],
      z,
    })),
    feat: { sprites: { eyes: [10, 10, 20, 20] } },
    schemes: [{ id: "classic" }, { id: "lab" }, { id: "maid" }],
    ...(version
      ? {
          motionRig: {
            version,
            limbs,
            hiddenParts: [],
            ...(version === 2
              ? { poses: authoredFixture.poses as AuthoredPoses }
              : {}),
          },
        }
      : {}),
  };
}
function humanSurfaces() {
  class Image {
    private url = "";
    width = 100;
    height = 100;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      this.url = value;
      queueMicrotask(() => this.onload?.());
    }
    get src() {
      return this.url;
    }
  }
  vi.stubGlobal("Image", Image);
  const face = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "createRadialGradient"
          ? () => ({ addColorStop: () => undefined })
          : vi.fn(),
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, kind: string) {
      if (kind === "2d") return face;
      return new Proxy(
        {},
        {
          get: (_, key) => {
            if (key === "canvas") return this;
            if (
              ["getShaderParameter", "getProgramParameter"].includes(
                String(key),
              )
            )
              return () => true;
            if (key === "getExtension")
              return () => ({ loseContext: () => undefined });
            return vi.fn(() => ({}));
          },
        },
      );
    } as unknown as HTMLCanvasElement["getContext"],
  );
}
test("actual v1 human front stand/sit/expression and schemes opt into stable display basis", async () => {
  humanSurfaces();
  const figure = await createHumanFigure({
    model: humanModel(1),
    scheme: "classic",
    asset: (path) => path,
  });
  expect(figure.groupFacing?.()).toBe(1);
  const group = document.createElementNS(NS, "g");
  const pet = createPet(
    {
      petG: group,
      shadowEl: document.createElementNS(NS, "ellipse"),
      fxG: document.createElementNS(NS, "g"),
    },
    {
      figure,
      roam: "off",
      walkInPlace: true,
      startX: 180,
      sfx: new Proxy({}, { get: () => () => undefined }),
      bounds: () => ({ W: 400, H: 600, floorY: 560, S: 0.7933 }),
    },
  );
  for (const mode of ["stand", "sit", "sleep"]) {
    pet.replaceReaction(mode, "happy", true);
    pet.render();
    pet.pointerMove({ x: 70, y: 430 });
    for (let i = 0; i < 100; i++) {
      pet.step(1 / 60);
      pet.render();
      expect(matrix(group).a).toBe(0.7933);
    }
  }
  for (const scheme of ["lab", "maid", "classic"]) {
    await figure.setScheme(scheme);
    pet.step(1 / 60);
    pet.render();
    expect(matrix(group).a).toBe(0.7933);
  }
  figure.dispose();
});
for (const version of [undefined, 2] as const) {
  test(`actual human ${version === undefined ? "no-rig" : "authored v2"} does not declare fixed group facing`, async () => {
    humanSurfaces();
    const figure = await createHumanFigure({
      model: humanModel(version),
      scheme: "classic",
      asset: (path) => path,
    });
    expect(Object.hasOwn(figure, "groupFacing")).toBe(false);
    figure.dispose();
  });
}
