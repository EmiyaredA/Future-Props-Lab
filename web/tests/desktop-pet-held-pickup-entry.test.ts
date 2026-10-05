import { afterEach, expect, test, vi } from "vitest";
import { createPet } from "@features/desktop-pet/whale-vendor/pet-core.js";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import { readFrameSequences } from "@features/desktop-pet/sequences/validation";
import type { SequencePoint } from "@features/desktop-pet/sequences/types";
import type { PetMotionFrame } from "@platform/petMotion";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";

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
function setup(scale: number, withHeld = true) {
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
    sequences: pack(withHeld),
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

for (const scale of [0.7933, 1.2735]) {
  for (const offset of [
    [0, 0],
    [24, -60],
  ] as SequencePoint[]) {
    test(`real core preserves the first identical cel and transfers pickup over 220ms at ${scale}, ${offset}`, async () => {
      const stage = setup(scale);
      await stage.figure.preload();
      stage.pet.render();
      const before = stage.current();
      const pointer = stage.grab(offset);
      expect(stage.current().cell).toBe(0);
      closePoint(stage.current().world, before.world);
      await settle();
      stage.pet.render();
      stage.advance(0.11);
      closePoint(stage.current().world, [
        (before.world[0] + pointer[0]) / 2,
        (before.world[1] + pointer[1]) / 2,
      ]);
      stage.advance(0.11);
      closePoint(stage.current().world, pointer);
      stage.advance(0.3);
      expect(stage.current().cell).toBe(2);
      closePoint(stage.current().world, pointer);
      expect(stage.figure.getMotionFailure?.()).toBeNull();
      stage.figure.dispose?.();
    });
  }
  test(`pending first held decode retains the old cel registration at ${scale}`, async () => {
    const stage = setup(scale);
    await stage.figure.preload();
    stage.pet.render();
    const before = stage.current();
    stage.wait();
    const pointer = stage.grab([24, -60]);
    await settle();
    stage.advance(0.11);
    expect(stage.current().cell).toBe(0);
    closePoint(stage.current().world, [
      (before.world[0] + pointer[0]) / 2,
      (before.world[1] + pointer[1]) / 2,
    ]);
    stage.advance(0.13);
    closePoint(stage.current().world, pointer);
    const pending = stage.current();
    stage.resolve();
    await settle();
    stage.pet.render();
    expect(stage.current().cell).toBe(0);
    closePoint(stage.current().world, pending.world);
    stage.advance(0.4);
    expect(stage.current().cell).toBe(2);
    closePoint(stage.current().world, pointer);
    stage.figure.dispose?.();
  });
  test(`rapid regrab latches the actually painted translated cel at ${scale}`, async () => {
    const stage = setup(scale);
    await stage.figure.preload();
    stage.pet.render();
    stage.grab([24, -60]);
    await settle();
    stage.advance(0.6);
    const before = stage.current();
    expect(before.box.slice(0, 2)).toEqual([-40, 40]);
    stage.pet.setLocomotion(null);
    stage.figure.cancelMotionPlayback?.();
    const pointer = stage.grab([-25, 35]);
    closePoint(stage.current().world, before.world);
    stage.advance(0.22);
    closePoint(stage.current().world, pointer);
    stage.figure.dispose?.();
  });
  test(`release handoff keeps nonzero inner registration for the identical departure cel at ${scale}`, async () => {
    const stage = setup(scale);
    await stage.figure.preload();
    stage.pet.render();
    stage.grab([24, -60]);
    await settle();
    stage.advance(0.6);
    const before = stage.current();
    expect(before.box.slice(0, 2)).toEqual([-40, 40]);
    expect(stage.pet.beginPlacementHandoff(10)).toBe(true);
    stage.viewport.x += 30;
    stage.viewport.y -= 20;
    stage.pet.render();
    closePoint(stage.current().world, before.world);
    expect(stage.pet.commitPlacementHandoff(10)).toBe(true);
    stage.pet.setLocomotion(null);
    stage.pet.render();
    expect(stage.current().cell).toBe(2);
    expect(stage.current().box.slice(0, 2)).toEqual([-40, 40]);
    closePoint(stage.current().world, before.world);
    stage.figure.dispose?.();
  });
  test(`legacy figure still receives the eased clicked grip at ${scale}`, () => {
    const frames: WhaleFrame[] = [];
    const group = document.createElementNS(NS, "g");
    const pet = createPet(
      {
        petG: group,
        shadowEl: document.createElementNS(NS, "ellipse"),
        fxG: document.createElementNS(NS, "g"),
      },
      {
        roam: "off",
        walkInPlace: true,
        startX: 180,
        bounds: () => ({ W: 400, H: 600, floorY: 560, S: scale }),
        sfx: new Proxy({}, { get: () => () => undefined }),
        figure: {
          fixedScale: true,
          pickupPoint: () => [128, 188],
          draw: (_g: SVGGElement, _face: unknown, f: WhaleFrame) =>
            frames.push(f),
        },
      },
    );
    pet.render();
    const m = matrix(group);
    const p: [number, number] = [128, 128];
    pet.setLocomotion({
      state: "held",
      facing: 1,
      edge: null,
      phase: 0,
      velocity: { x: 0, y: 0 },
      swing: 0,
      grip: {
        x: m.a * p[0] + m.c * p[1] + m.e,
        y: m.b * p[0] + m.d * p[1] + m.f,
      },
    });
    pet.render();
    expect(frames.at(-1)!.gripPoint![1]).toBeCloseTo(128, 1);
    expect(frames.at(-1)!.heldPickupPoint).toEqual([128, 188]);
    for (let i = 0; i < 11; i++) pet.step(0.02);
    pet.render();
    expect(frames.at(-1)!.gripPoint).toEqual([128, 188]);
  });
}
test("missing held resource rejects without replacing the actually painted source cel", async () => {
  const stage = setup(0.7933, false);
  await stage.figure.preload();
  stage.pet.render();
  const before = stage.current();
  stage.grab([24, -60]);
  expect(stage.current().cell).toBe(0);
  expect(stage.current().box).toEqual(before.box);
  closePoint(stage.current().world, before.world);
  expect(stage.figure.getMotionFailure?.()).toBe("sequence:missing-clip");
  stage.figure.dispose?.();
});
test("explicit retry keeps the asset failure public during pending decode until genuine paint", async () => {
  const stage = setup(0.7933);
  await stage.figure.preload();
  stage.pet.render();
  stage.wait();
  stage.grab([24, -60]);
  await settle();
  stage.reject();
  await settle();
  stage.pet.render();
  expect(stage.figure.getMotionFailure?.()).toBe("actual-held-decode-failure");
  stage.wait();
  stage.figure.retryAssetLoad?.();
  stage.pet.render();
  await settle();
  expect(stage.figure.getMotionFailure?.()).toBe("actual-held-decode-failure");
  expect(stage.figure.getAssetFailure?.()).toBe("actual-held-decode-failure");
  stage.resolve();
  await settle();
  expect(stage.figure.getMotionFailure?.()).toBe("actual-held-decode-failure");
  stage.pet.render();
  expect(stage.figure.getMotionFailure?.()).toBeNull();
  stage.figure.dispose?.();
});
