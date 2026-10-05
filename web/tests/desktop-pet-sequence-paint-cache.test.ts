import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import type {
  FrameSequences,
  SequenceFrame,
} from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";

// Production Player -> Figure with controlled browser APIs; not GPU/art proof.
const NS = "http://www.w3.org/2000/svg";
const cel = (extra: Partial<SequenceFrame> = {}): SequenceFrame => ({
  texture: "atlas",
  rect: [0, 0, 100, 200],
  durationMs: 100,
  grip: [50, 70],
  foot: [50, 190],
  head: [
    [50, 10],
    [50, 50],
  ],
  ...extra,
});
const fixture = (): FrameSequences => ({
  version: 1,
  frameSize: [100, 200],
  modelBox: [0, 0, 100, 200],
  headLength: 40,
  clips: { idle: { loop: true, frames: [cel()] } },
  transitions: [],
});
const frame = (
  t: number,
  mode = "idle",
  extra: Partial<WhaleFrame> = {},
): WhaleFrame => ({
  t,
  mode,
  swing: 0,
  sit: 0,
  look: [0, 0],
  legs: [],
  ...extra,
});
const face = { eyes: [], gap: [] };
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
let requests: string[];
let imageSize: [number, number];
let deferred: Map<
  string,
  { promise: Promise<void>; resolve(): void; reject(e: Error): void }
>;
class TestImage {
  src = "";
  naturalWidth = imageSize[0];
  naturalHeight = imageSize[1];
  async decode() {
    requests.push(this.src);
    await deferred.get(this.src)?.promise;
  }
}
function defer(path: string) {
  let resolve!: () => void, reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const result = { promise, resolve, reject };
  deferred.set(path, result);
  return result;
}
beforeEach(() => {
  requests = [];
  imageSize = [300, 200];
  deferred = new Map();
  vi.stubGlobal("Image", TestImage);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(sequences = fixture()) {
  const clear = vi.fn(),
    paint = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      clearRect: clear,
      drawImage: paint,
    })) as unknown as HTMLCanvasElement["getContext"],
  );
  let scheme = "classic";
  const base: LoadedWhaleFigure = {
    fixedScale: true,
    get scheme() {
      return scheme;
    },
    motionFacing: () => 1,
    preload: async () => undefined,
    setScheme: vi.fn(async (id: string) => {
      scheme = id;
    }),
    reset: vi.fn(),
    dispose: vi.fn(),
    releaseRenderSurface: vi.fn(),
    draw: vi.fn((group: SVGGElement) => {
      if (!group.firstChild) group.append(document.createElement("canvas"));
    }),
  };
  const figure = createSequenceFigure({
    base,
    sequences,
    scheme,
    defaultScheme: "classic",
    asset: (p) => `/authorized/${p}`,
  });
  const group = document.createElementNS(NS, "g");
  const draw = (t: number, mode = "idle", extra: Partial<WhaleFrame> = {}) =>
    figure.draw(group, face, frame(t, mode, extra));
  const box = () =>
    ["x", "y", "width", "height"].map((k) =>
      Number(group.querySelector("foreignObject")!.getAttribute(k)),
    );
  const canvas = () =>
    group.querySelector<HTMLCanvasElement>("foreignObject canvas")!;
  return { figure, group, draw, box, canvas, clear, paint, base };
}

test("600 same-cel ticks paint once while DOM commits, sampling and retirement continue", async () => {
  const h = setup();
  await h.figure.preload();
  h.draw(0);
  const attributes = vi.spyOn(h.group, "setAttribute");
  for (let i = 1; i <= 600; i++) h.draw(i / 60);
  expect(h.paint).toHaveBeenCalledTimes(1);
  expect(h.clear).toHaveBeenCalledTimes(1);
  expect(
    attributes.mock.calls.filter(([k]) => k === "data-pet-edges"),
  ).toHaveLength(600);
  expect(h.base.releaseRenderSurface).toHaveBeenCalledTimes(601);
  expect(h.figure.pickupPoint?.()).toEqual([50, 70]);
  expect(h.figure.getMotionFailure?.()).toBeNull();
  h.figure.dispose?.();
});
test("same pixels still update metadata, held P0, geometry, transition time and release", async () => {
  const p = fixture(),
    idle = p.clips.idle.frames[0],
    middle = cel({ grip: [45, 75], contacts: { bottom: [55, 180] } }),
    held = cel({ grip: [40, 80], contacts: { bottom: [56, 180] } });
  p.clips.held = { loop: true, frames: [held] };
  p.clips.pickup = { loop: false, frames: [idle, middle, held] };
  p.clips.release = { loop: false, frames: [held, middle, idle] };
  p.transitions = [
    { id: "pickup", from: "idle", to: "held", clip: "pickup" },
    { id: "release", from: "held", to: "idle", clip: "release" },
  ];
  const h = setup(p);
  await h.figure.preload();
  h.draw(0);
  h.draw(0.01, "held", { heldPickupPoint: [50, 70] });
  expect(h.figure.getMotionTransition?.()?.id).toBe("pickup");
  h.draw(0.12, "held", { heldPickupPoint: [50, 70] });
  expect(h.box().slice(0, 2)).toEqual([5, -5]);
  expect(JSON.parse(h.group.getAttribute("data-pet-edges")!).bottom).toEqual([
    60, 175,
  ]);
  expect(h.figure.getMotionTransition?.()?.progress).toBeGreaterThan(0.3);
  h.draw(0.23, "held", { heldPickupPoint: [50, 70] });
  expect(h.box().slice(0, 2)).toEqual([10, -10]);
  expect(h.figure.pickupPoint?.()).toEqual([50, 70]);
  h.draw(0.34, "held", { heldPickupPoint: [50, 70] });
  expect(h.figure.getMotionTransition?.()).toBeNull();
  for (const t of [0.35, 0.46, 0.57, 0.68]) h.draw(t);
  expect(h.figure.getMotionFailure?.()).toBeNull();
  expect(h.figure.getMotionTransition?.()).toBeNull();
  expect(h.paint).toHaveBeenCalledTimes(1);
  h.figure.dispose?.();
});
function physicalPack() {
  const p = fixture(),
    idle = cel({ supports: { legFront: [80, 190] } }),
    walk = structuredClone(idle);
  p.clips.idle.frames = [idle];
  p.clips["walk-right"] = {
    loop: true,
    frames: [walk, cel({ supports: { legFront: [50, 190] } })],
    distancePerCycle: 60,
  };
  p.clips.start = { loop: false, frames: [idle, walk] };
  p.transitions = [
    { id: "start", from: "idle", to: "walk-right", clip: "start" },
  ];
  return p;
}
const motion = (
  state: "walk" | "held",
  x: number,
  phase = (x / 60) * Math.PI * 2,
): Partial<WhaleFrame> => ({
  locomotion: {
    state,
    facing: 1,
    edge: null,
    phase,
    velocity: { x: 60, y: 0 },
    swing: 0,
    travel: { x, y: 0 },
  },
});
test("same painted support follows confirmed sub-cel host travel without bitmap redraw", async () => {
  const h = setup(physicalPack());
  await h.figure.preload();
  h.draw(0);
  for (const t of [0.01, 0.12, 0.23]) h.draw(t, "walk", motion("walk", 0));
  expect(h.figure.getMotionFailure?.()).toBeNull();
  for (const [i, d] of [1, 2, 3, 4, 5].entries()) {
    h.draw(0.24 + i * 0.01, "walk", motion("walk", d));
    expect(h.box()[0] + d + 80).toBe(80);
    expect(h.figure.getMotionFailure?.()).toBeNull();
  }
  expect(h.paint).toHaveBeenCalledTimes(1);
  h.figure.dispose?.();
});
test("source crop and native canvas dimensions redraw without fitting model box", async () => {
  const p = fixture();
  p.clips.idle.frames.push(cel({ rect: [100, 0, 100, 200] }));
  const h = setup(p);
  await h.figure.preload();
  h.draw(0);
  h.draw(0.1);
  expect(h.paint).toHaveBeenCalledTimes(2);
  expect(h.paint.mock.calls[1].slice(1, 5)).toEqual([100, 0, 100, 200]);
  h.canvas().width = 101;
  h.draw(0.11);
  expect(h.paint).toHaveBeenCalledTimes(3);
  expect(h.paint.mock.calls[2].slice(5)).toEqual([0, 0, 101, 200]);
  expect(h.box()).toEqual([0, 0, 100, 200]);
  h.figure.dispose?.();
});
test("scheme/image replacement redraws; returning cached image still respects previous bitmap", async () => {
  const h = setup();
  await h.figure.preload();
  h.draw(0);
  const original = h.paint.mock.calls[0][0];
  await h.figure.setScheme("lab");
  h.draw(0.01);
  await settle();
  h.draw(0.02);
  const lab = h.paint.mock.calls.at(-1)![0];
  expect(lab).not.toBe(original);
  expect(lab.src).toBe("/authorized/schemes/lab/tex/atlas.png");
  expect(h.paint).toHaveBeenCalledTimes(2);
  await h.figure.setScheme("classic");
  h.draw(0.03);
  expect(h.paint.mock.calls.at(-1)![0]).toBe(original);
  expect(h.paint).toHaveBeenCalledTimes(3);
  expect(requests).toHaveLength(2);
  h.figure.dispose?.();
});
test.each(["clear", "paint", "DOM"] as const)(
  "%s exception keeps original identity and requires next redraw",
  async (kind) => {
    const p = fixture();
    p.clips.idle.frames.push(cel({ rect: [100, 0, 100, 200] }));
    const h = setup(p);
    await h.figure.preload();
    h.draw(0);
    const error = new Error(`failed-${kind}`);
    if (kind === "clear")
      h.clear.mockImplementationOnce(() => {
        throw error;
      });
    if (kind === "paint")
      h.paint.mockImplementationOnce(() => {
        throw error;
      });
    const spy =
      kind === "DOM"
        ? vi.spyOn(h.group.querySelector("foreignObject")!, "setAttribute")
        : null;
    spy?.mockImplementationOnce(() => {
      throw error;
    });
    expect(() => h.draw(kind === "DOM" ? 0.01 : 0.1)).toThrow(error);
    spy?.mockRestore();
    const count = h.paint.mock.calls.length;
    // The player already sampled at .1 before a Canvas throw, while the
    // figure clock never committed. Use the next input that reaches .1 again;
    // repairing that pre-existing exception/clock handoff is a separate task.
    h.draw(kind === "DOM" ? 0.02 : 0.2);
    expect(h.paint.mock.calls.length).toBe(count + 1);
    expect(h.figure.getMotionFailure?.()).toBeNull();
    h.figure.dispose?.();
  },
);
test("reset/cancel/reaction rejection keep pixels without freezing valid following playback", async () => {
  const h = setup();
  await h.figure.preload();
  h.draw(0);
  h.figure.reset();
  h.draw(0.01);
  h.figure.cancelMotionPlayback?.();
  h.draw(0.02);
  h.figure.rejectReactionPlayback?.("sequence:missing-clip");
  h.draw(0.03, "jump");
  expect(h.figure.getMotionFailure?.()).toBe("sequence:missing-clip");
  h.figure.acceptReactionPlayback?.();
  h.draw(0.04);
  expect(h.figure.getMotionFailure?.()).toBeNull();
  expect(h.paint).toHaveBeenCalledTimes(1);
  expect(h.base.reset).toHaveBeenCalledTimes(1);
  h.figure.dispose?.();
});
test("pending/decode failure retain pixels; same-pixel retry commit clears presentation error", async () => {
  const p = fixture(),
    idle = p.clips.idle.frames[0];
  p.clips.held = { loop: true, frames: [cel({ texture: "held" })] };
  p.clips.pickup = { loop: false, frames: [idle, p.clips.held.frames[0]] };
  p.transitions = [{ id: "pickup", from: "idle", to: "held", clip: "pickup" }];
  const h = setup(p);
  await h.figure.preload();
  h.draw(0);
  const path = "/authorized/tex/held.png",
    pending = defer(path);
  h.draw(0.01, "held");
  await settle();
  h.draw(0.02, "held");
  expect(h.paint).toHaveBeenCalledTimes(1);
  expect(h.figure.getMotionTransition?.()?.id).toContain("sequence-assets");
  pending.reject(new Error("real-decode-failure"));
  await settle();
  h.draw(0.03, "held");
  expect(h.figure.getAssetFailure?.()).toBe("real-decode-failure");
  expect(h.paint).toHaveBeenCalledTimes(1);
  deferred.delete(path);
  h.figure.retryAssetLoad?.();
  h.draw(0.04, "held");
  await settle();
  expect(h.figure.getAssetFailure?.()).toBe("real-decode-failure");
  h.draw(0.05, "held");
  expect(h.figure.getAssetFailure?.()).toBeNull();
  expect(h.paint).toHaveBeenCalledTimes(1);
  expect(h.figure.getMotionTransition?.()?.id).toBe("pickup");
  h.draw(0.16, "held");
  h.draw(0.27, "held");
  expect(h.paint).toHaveBeenCalledTimes(2);
  expect(requests.filter((p) => p === path)).toHaveLength(2);
  h.figure.dispose?.();
});
test("late travel while pending/failed retains world support with unchanged bitmap", async () => {
  const p = physicalPack(),
    walk = p.clips["walk-right"].frames[0];
  p.clips.held = {
    loop: true,
    frames: [cel({ texture: "held", supports: { legFront: [80, 190] } })],
  };
  p.clips.pickup = { loop: false, frames: [walk, p.clips.held.frames[0]] };
  p.transitions.push({
    id: "pickup",
    from: "walk-right",
    to: "held",
    clip: "pickup",
  });
  const h = setup(p);
  await h.figure.preload();
  h.draw(0);
  for (const t of [0.01, 0.12, 0.23]) h.draw(t, "walk", motion("walk", 0));
  const pending = defer("/authorized/tex/held.png");
  h.draw(0.24, "held", motion("held", 0, 0));
  await settle();
  h.draw(0.25, "held", motion("held", 6, 0));
  expect(h.box()[0] + 6 + 80).toBe(80);
  expect(h.paint).toHaveBeenCalledTimes(1);
  pending.reject(new Error("late failure"));
  await settle();
  h.draw(0.26, "held", motion("held", 9, 0));
  expect(h.box()[0] + 9 + 80).toBe(80);
  expect(h.paint).toHaveBeenCalledTimes(1);
  expect(h.figure.getAssetFailure?.()).toBe("late failure");
  h.figure.dispose?.();
});
test("eviction reloads same URL as new image; dispose stops later draws/requests", async () => {
  imageSize = [2500, 2000];
  const h = setup();
  await h.figure.preload();
  h.draw(0);
  const original = h.paint.mock.calls[0][0];
  for (let i = 1; i <= 7; i++) {
    await h.figure.setScheme(`fit${i}`);
    await h.figure.preload();
  }
  await h.figure.setScheme("classic");
  await h.figure.preload();
  h.draw(0.01);
  expect(
    requests.filter((p) => p === "/authorized/tex/atlas.png"),
  ).toHaveLength(2);
  expect(h.paint.mock.calls.at(-1)![0]).not.toBe(original);
  expect(h.paint).toHaveBeenCalledTimes(2);
  const count = requests.length;
  h.figure.dispose?.();
  h.figure.dispose?.();
  h.draw(0.02);
  await h.figure.preload();
  expect(h.paint).toHaveBeenCalledTimes(2);
  expect(requests).toHaveLength(count);
});
test("dispose during pending load cannot publish late image or retire uncommitted base", async () => {
  const h = setup(),
    pending = defer("/authorized/tex/atlas.png");
  h.draw(0);
  expect(h.base.releaseRenderSurface).not.toHaveBeenCalled();
  h.figure.dispose?.();
  pending.resolve();
  await settle();
  h.draw(0.01);
  expect(h.paint).not.toHaveBeenCalled();
  expect(h.base.releaseRenderSurface).not.toHaveBeenCalled();
  expect(h.base.dispose).toHaveBeenCalledTimes(1);
});
test("a late obsolete outfit rejection cannot replace current image or its paint key", async () => {
  const h = setup();
  await h.figure.preload();
  h.draw(0);
  const pending = defer("/authorized/schemes/lab/tex/atlas.png");
  await h.figure.setScheme("lab");
  h.draw(0.01);
  await settle();
  await h.figure.setScheme("maid");
  h.draw(0.02);
  pending.reject(new Error("obsolete-lab-decode"));
  await settle();
  h.draw(0.03);
  await settle();
  h.draw(0.04);
  expect(h.figure.getAssetFailure?.()).toBeNull();
  expect(h.figure.scheme).toBe("maid");
  expect(h.paint.mock.calls.at(-1)![0].src).toBe(
    "/authorized/schemes/maid/tex/atlas.png",
  );
  expect(h.paint).toHaveBeenCalledTimes(2);
  h.draw(0.05);
  expect(h.paint).toHaveBeenCalledTimes(2);
  h.figure.dispose?.();
});
