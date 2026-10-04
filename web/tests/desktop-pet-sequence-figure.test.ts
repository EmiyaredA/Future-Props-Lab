import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import type {
  FrameSequences,
  SequenceFrame,
} from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";

const face = { eyes: [], gap: [] };
const cel = (texture: string, index: number): SequenceFrame => ({
  texture,
  rect: [index * 100, 0, 100, 200],
  durationMs: 100,
  grip: [50, 70],
  foot: [50, 190],
  head: [
    [50, 10],
    [50, 50],
  ],
});
const fixture = (): FrameSequences => {
  const idle = cel("idle", 0),
    walk = cel("walk", 0),
    held = cel("held", 0);
  return {
    version: 1,
    frameSize: [100, 200],
    modelBox: [20, 30, 50, 100],
    headLength: 20,
    clips: {
      idle: { frames: [idle, cel("idle", 1)], loop: true },
      "walk-right": {
        frames: [walk, cel("walk", 1)],
        loop: true,
        distancePerCycle: 60,
      },
      held: { frames: [held, cel("held", 1)], loop: true },
      start: { frames: [idle, cel("entry", 0), walk], loop: false },
      pickup: { frames: [idle, cel("entry", 1), held], loop: false },
    },
    transitions: [
      { id: "start-walk", from: "idle", to: "walk-right", clip: "start" },
      { id: "pickup", from: "idle", to: "held", clip: "pickup" },
    ],
  };
};
const frame = (t: number, mode = "idle", phase = 0): WhaleFrame => ({
  t,
  mode,
  swing: 0,
  sit: 0,
  look: [0, 0],
  legs: [],
  ...(mode === "walk"
    ? {
        locomotion: {
          state: "walk" as const,
          facing: 1 as const,
          edge: null,
          phase,
          velocity: { x: 60, y: 0 },
          swing: 0,
        },
      }
    : {}),
});

let requests: string[];
let rejections: Set<string>;
let dimensions: Map<string, [number, number]>;
let pending: Map<
  string,
  {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  }
>;
const decodeKey = (src: string) => src.split("/").at(-1)!.replace(".png", "");
class TestImage {
  src = "";
  naturalWidth = 600;
  naturalHeight = 200;
  async decode() {
    requests.push(this.src);
    const key = decodeKey(this.src);
    const size = dimensions.get(key);
    if (size) [this.naturalWidth, this.naturalHeight] = size;
    if (rejections.has(key)) throw new Error(`decode-${key}`);
    await pending.get(key)?.promise;
  }
}
const defer = (texture: string) => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  pending.set(texture, { promise, resolve, reject });
  return { resolve, reject };
};
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const setup = (pack = fixture(), scheme = "classic") => {
  const drawImage = vi.fn();
  const clearRect = vi.fn();
  const context = {
    drawImage,
    clearRect,
  } as unknown as CanvasRenderingContext2D;
  // Canvas exposes several overloads; this harness only consumes its 2D branch.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => context) as unknown as HTMLCanvasElement["getContext"],
  );
  let baseScheme = scheme;
  const baseDraw = vi.fn((group: SVGGElement) => {
    if (!group.firstChild) group.append(document.createElement("canvas"));
  });
  const base: LoadedWhaleFigure = {
    fixedScale: true,
    get scheme() {
      return baseScheme;
    },
    motionFacing: () => 1,
    pickupPoint: () => [45, 65],
    preload: vi.fn(async () => undefined),
    setScheme: vi.fn(async (id: string) => {
      baseScheme = id;
    }),
    reset: vi.fn(),
    dispose: vi.fn(),
    draw: baseDraw,
  };
  const asset = vi.fn((path: string) => `/authorized/${path}`);
  const options = {
    base,
    sequences: pack,
    scheme,
    defaultScheme: "classic",
    asset,
  };
  const figure = createSequenceFigure(options);
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const draw = (t: number, mode = "idle", phase = 0) =>
    figure.draw(group, face, frame(t, mode, phase));
  const latest = () => drawImage.mock.calls.at(-1)!;
  const box = () => {
    const element = group.querySelector("foreignObject")!;
    return ["x", "y", "width", "height"].map((name) =>
      Number(element.getAttribute(name)),
    );
  };
  return {
    figure,
    group,
    draw,
    latest,
    box,
    drawImage,
    clearRect,
    base,
    baseDraw,
    asset,
  };
};

beforeEach(() => {
  requests = [];
  rejections = new Set();
  dimensions = new Map();
  pending = new Map();
  vi.stubGlobal("Image", TestImage);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("real whole sequence Canvas figure", () => {
  it("draws the initial complete idle cel at the fixed modelBox", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    expect(h.latest().slice(1)).toEqual([0, 0, 100, 200, 0, 0, 100, 200]);
    expect(h.box()).toEqual([20, 30, 50, 100]);
    expect(h.figure.pickupPoint?.()).toEqual([45, 65]);
    expect(h.group.getAttribute("data-pet-sequence")).toBe("true");
    expect(
      h.group.querySelector('canvas[data-pet-raster-active="true"]'),
    ).not.toBeNull();
  });
  it("retains identical destination dimensions across frames and complete action entry", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    h.draw(0.1);
    expect(h.latest()[1]).toBe(100);
    expect(h.latest().slice(5)).toEqual([0, 0, 100, 200]);
    expect(h.box()).toEqual([20, 30, 50, 100]);
    // Return to a registered idle entry cel before choosing a different action.
    h.draw(0.2);
    h.draw(0.2, "walk");
    await settle();
    h.draw(0.21, "walk");
    for (const t of [0.31, 0.41, 0.51, 0.61]) h.draw(t, "walk");
    h.draw(0.62, "walk", Math.PI);
    expect(decodeKey(h.latest()[0].src)).toBe("walk");
    for (const call of h.drawImage.mock.calls)
      expect(call.slice(5)).toEqual([0, 0, 100, 200]);
    expect(h.box()).toEqual([20, 30, 50, 100]);
    expect(h.figure.fixedScale).toBe(true);
    expect(h.group.getAttribute("data-pet-stride")).toBe("60");
  });
  it("paints physical idle before accepting a first requested walk entry", async () => {
    const h = setup();
    h.draw(0, "walk");
    await settle();
    h.draw(0.01, "walk");
    expect(decodeKey(h.latest()[0].src)).toBe("idle");
    expect(h.latest()[1]).toBe(0);
    expect(h.figure.getMotionTransition?.()?.progress).toBe(0);
    const count = h.drawImage.mock.calls.length;
    h.draw(0.02, "walk");
    expect(h.drawImage).toHaveBeenCalledTimes(count + 1);
    expect(h.figure.getMotionTransition?.()?.id).toBe("start-walk");
  });
  it("keeps confirmed phase still despite a long idle wall clock between walk draws", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    h.draw(0, "walk");
    await settle();
    for (const t of [0.01, 0.11, 0.21, 0.31, 0.41]) h.draw(t, "walk");
    h.draw(0.42, "walk", Math.PI);
    const before = h.latest();
    h.draw(100, "walk", Math.PI);
    expect(h.latest().slice(1)).toEqual(before.slice(1));
    expect(h.box()).toEqual([20, 30, 50, 100]);
  });
  it("loads the default outfit from tex and later outfits from schemes/{id}/tex", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    expect(h.asset).toHaveBeenCalledWith("tex/idle.png");
    await h.figure.setScheme("laboratory");
    h.draw(0.1);
    await settle();
    h.draw(0.2);
    expect(h.asset).toHaveBeenCalledWith("schemes/laboratory/tex/idle.png");
    expect(h.latest()[0].src).toBe(
      "/authorized/schemes/laboratory/tex/idle.png",
    );
    expect(h.box()).toEqual([20, 30, 50, 100]);
    expect(h.base.setScheme).toHaveBeenCalledWith("laboratory", undefined);
  });
  it("preserves the actually painted cel while a new texture is decoding", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    const before = h.latest();
    const count = h.drawImage.mock.calls.length;
    const hold = defer("held");
    h.draw(0.01, "held");
    await settle();
    h.draw(10, "held");
    expect(h.drawImage).toHaveBeenCalledTimes(count);
    expect(h.latest()).toEqual(before);
    expect(h.box()).toEqual([20, 30, 50, 100]);
    expect(h.figure.getMotionTransition?.()?.progress).toBe(0);
    hold.resolve();
    await settle();
    h.draw(10.01, "held");
    expect(h.drawImage.mock.calls.length).toBeGreaterThan(count);
    expect(h.figure.getMotionFailure?.()).toBeNull();
  });
  it("preserves the painted frame after decode failure without exposing stale playback progress", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    const count = h.drawImage.mock.calls.length;
    rejections.add("held");
    h.draw(0.01, "held");
    await settle();
    h.draw(0.02, "held");
    h.draw(0.03, "held");
    expect(h.drawImage).toHaveBeenCalledTimes(count);
    expect(h.figure.getMotionFailure?.()).toContain("decode-held");
    expect(h.figure.getMotionTransition?.()).toBeNull();
    expect(
      h.group.querySelector('canvas[data-pet-raster-active="true"]'),
    ).not.toBeNull();
  });
  it("never draws an atlas rejected by actual image bounds validation", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    const count = h.drawImage.mock.calls.length;
    dimensions.set("held", [50, 100]);
    h.draw(0.01, "held");
    await settle();
    h.draw(0.02, "held");
    h.draw(0.03, "held");
    expect(h.figure.getMotionFailure?.()).toContain("完整序列帧资源无效");
    expect(h.drawImage).toHaveBeenCalledTimes(count);
    expect(h.figure.getMotionTransition?.()).toBeNull();
  });
  it("clears loading feedback when a loaded action lacks a declared transition", async () => {
    const pack = fixture();
    pack.transitions = [];
    const h = setup(pack);
    await h.figure.preload();
    h.draw(0);
    const count = h.drawImage.mock.calls.length;
    h.draw(0.01, "held");
    await settle();
    h.draw(0.02, "held");
    expect(h.figure.getMotionFailure?.()).toContain("missing-transition");
    expect(h.figure.getMotionTransition?.()).toBeNull();
    expect(h.drawImage).toHaveBeenCalledTimes(count);
  });
  it("does not commit the pose from an obsolete decode during rapid selection", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    const hold = defer("held");
    h.draw(0.01, "held");
    await settle();
    h.figure.cancelMotionPlayback?.();
    h.draw(0.02, "idle");
    hold.resolve();
    await settle();
    h.draw(0.03, "idle");
    expect(decodeKey(h.latest()[0].src)).toBe("idle");
    expect(h.figure.getMotionFailure?.()).toBeNull();
    expect(h.figure.getMotionTransition?.()).toBeNull();
  });
  it("a stale decoder rejection cannot poison a newly selected valid idle", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    const hold = defer("held");
    h.draw(0.01, "held");
    await settle();
    h.figure.cancelMotionPlayback?.();
    h.draw(0.02, "idle");
    hold.reject(new Error("obsolete-decode"));
    await settle();
    h.draw(0.03, "idle");
    expect(decodeKey(h.latest()[0].src)).toBe("idle");
    expect(h.figure.getMotionFailure?.()).toBeNull();
    expect(h.figure.getMotionTransition?.()).toBeNull();
  });
  it("keeps a single canvas across replay and never invokes old body/face painting after load", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    const canvas = h.group.querySelector("foreignObject canvas");
    const fallbackCalls = h.baseDraw.mock.calls.length;
    h.draw(0.1);
    const before = h.latest();
    h.figure.cancelMotionPlayback?.();
    h.draw(50);
    expect(h.latest().slice(1)).toEqual(before.slice(1));
    expect(h.group.querySelector("foreignObject canvas")).toBe(canvas);
    expect(h.base.draw).toHaveBeenCalledTimes(fallbackCalls);
    expect(h.box()).toEqual([20, 30, 50, 100]);
  });
});
