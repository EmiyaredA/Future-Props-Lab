import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readFrameSequences,
  validateSequenceImages,
} from "@features/desktop-pet/sequences/validation";
import { SequencePlayer } from "@features/desktop-pet/sequences/player";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import type { SequenceFrame } from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";

const frame = (texture = "painted"): SequenceFrame => ({
  texture,
  rect: [0, 0, 100, 100],
  durationMs: 100,
  grip: [50, 40],
  foot: [30, 80],
  head: [
    [50, 10],
    [50, 30],
  ],
  contacts: { bottom: [30, 80] },
  supports: { legFront: [30, 80] },
});
type Raw = {
  version: number;
  frameSize: number[];
  modelBox: number[];
  headLength: number;
  cels?: unknown;
  clips: Record<string, { frames: unknown[]; loop: boolean }>;
  transitions: unknown[];
};
const raw = (): Raw => ({
  version: 1,
  frameSize: [100, 100],
  modelBox: [0, 0, 100, 100],
  headLength: 20,
  cels: { resting: frame() },
  clips: { idle: { frames: ["resting"], loop: true } },
  transitions: [],
});
const declarations = (pack: Raw) => pack.cels as Record<string, unknown>;
const parse = (pack: Raw) => readFrameSequences(pack)!;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("optional complete cel registry", () => {
  it("expands mixed references and inline frames without mutating uploaded shape", () => {
    const source = raw();
    source.clips.idle.frames.push({ ...frame("inline"), durationMs: 250 });
    const before = JSON.stringify(source),
      parsed = parse(source);
    expect(parsed.clips.idle.frames.map((f) => f.texture)).toEqual([
      "painted",
      "inline",
    ]);
    expect(parsed.clips.idle.frames.map((f) => f.durationMs)).toEqual([
      100, 250,
    ]);
    expect(parsed.cels!.resting).toEqual(frame());
    expect(JSON.stringify(source)).toBe(before);
    const player = new SequencePlayer(parsed);
    expect(player.sample({ clip: "idle", t: 0 })!.frame.texture).toBe(
      "painted",
    );
    expect(player.sample({ clip: "idle", t: 0.15 })!.frame.texture).toBe(
      "inline",
    );
  });
  it("copies every nested use independently from the source and registry", () => {
    const source = raw();
    source.clips.idle.frames.push("resting");
    source.clips.other = { frames: ["resting"], loop: true };
    const parsed = parse(source),
      a = parsed.clips.idle.frames[0],
      b = parsed.clips.idle.frames[1],
      registry = parsed.cels!.resting;
    a.rect[0] = 100;
    a.grip[0] = 3;
    a.foot[0] = 4;
    a.head[0][1] = 5;
    a.contacts!.bottom![0] = 6;
    a.supports!.legFront![0] = 7;
    a.durationMs = 400;
    expect(b).toEqual(frame());
    expect(parsed.clips.other.frames[0]).toEqual(frame());
    expect(registry).toEqual(frame());
    expect(declarations(source).resting).toEqual(frame());
    expect(a).not.toBe(b);
    expect(b).not.toBe(registry);
  });
  it.each(["constructor", "toString", "__proto__"])(
    "resolves only explicit own safe-ID %s",
    (id) => {
      const source = raw();
      source.cels = JSON.parse(JSON.stringify({ [id]: frame("actual") }));
      source.clips.idle.frames = [id];
      const parsed = parse(source);
      expect(parsed.clips.idle.frames[0].texture).toBe("actual");
      expect(Object.hasOwn(parsed.cels!, id)).toBe(true);
      expect(Object.getPrototypeOf(parsed.cels!)).toBeNull();
    },
  );
  it.each([
    "constructor",
    "toString",
    "__proto__",
    "missing",
    "https://invalid/x",
    "../painted",
  ])("rejects absent or unsafe reference %s", (id) => {
    const source = raw();
    source.clips.idle.frames = [id];
    expect(() => parse(source)).toThrow(/引用/);
  });
  it("does not mistake an inherited declaration or a texture name for an own cel", () => {
    const source = raw();
    source.cels = Object.create({ hidden: frame() });
    source.clips.idle.frames = ["hidden"];
    expect(() => parse(source)).toThrow(/字典/);
    source.cels = { resting: frame("painted") };
    source.clips.idle.frames = ["painted"];
    expect(() => parse(source)).toThrow(/引用/);
  });
  it("preserves no-registry legacy input and rejects legacy string frames", () => {
    const source = raw();
    delete source.cels;
    source.clips.idle.frames = [frame()];
    expect(parse(source).cels).toBeUndefined();
    expect(parse(source).clips.idle.frames[0]).toEqual(frame());
    source.clips.idle.frames = ["resting"];
    expect(() => parse(source)).toThrow(/引用/);
  });
  it.each(["required-frame", "optional-frame", "contacts", "supports", "cels"])(
    "rejects inherited %s data instead of implicitly consuming it",
    (kind) => {
      let source = raw();
      const declared = frame();
      if (kind === "required-frame")
        declarations(source).resting = Object.create(declared);
      else if (kind === "optional-frame") {
        delete declared.supports;
        declarations(source).resting = Object.assign(
          Object.create({ supports: { legFront: [30, 80] } }),
          declared,
        );
      } else if (kind === "cels") {
        const cels = source.cels;
        delete source.cels;
        source = Object.assign(Object.create({ cels }), source);
      } else {
        declarations(source).resting = {
          ...declared,
          [kind]: Object.create(
            kind === "contacts" ? { bottom: [30, 80] } : { legFront: [30, 80] },
          ),
        };
      }
      expect(() => parse(source)).toThrow(/资源无效/);
    },
  );
  it.each(["grip", "rect", "frames"])(
    "rejects sparse %s arrays rather than copying undefined values",
    (kind) => {
      const source = raw();
      if (kind === "frames") source.clips.idle.frames = Array(1);
      else
        declarations(source).resting = {
          ...frame(),
          [kind]: Array(kind === "rect" ? 4 : 2),
        };
      expect(() => parse(source)).toThrow(/资源无效/);
    },
  );
  it.each([null, undefined, [], "resting", 1])(
    "rejects explicit malformed registry %s",
    (value) => {
      const source = raw();
      source.cels = value;
      expect(() => parse(source)).toThrow(/字典/);
    },
  );
  it.each(["https://source/cel", "../cel", "", "a".repeat(49)])(
    "rejects unsafe declaration key %s",
    (id) => {
      const source = raw();
      declarations(source)[id] = frame();
      expect(() => parse(source)).toThrow(/标识/);
    },
  );
  it.each([
    ["alias", "resting"],
    ["object-reference", { ref: "resting" }],
    ["timing-override", { ref: "resting", durationMs: 200 }],
    ["unknown-field", { ...frame(), extra: true }],
    ["texture-url", { ...frame(), texture: "https://source/art.png" }],
    ["nonfinite", { ...frame(), durationMs: Infinity }],
    ["negative-time", { ...frame(), durationMs: -1 }],
    ["wrong-rect", { ...frame(), rect: [0, 0, 99, 100] }],
    [
      "wrong-head",
      {
        ...frame(),
        head: [
          [50, 10],
          [50, 40],
        ],
      },
    ],
    ["bad-contact", { ...frame(), contacts: { left: [NaN, 20] } }],
    ["bad-support", { ...frame(), supports: { legFront: [30, 101] } }],
  ])("validates unused declaration %s", (_name, value) => {
    const source = raw();
    declarations(source).unused = value;
    expect(() => parse(source)).toThrow(/资源无效/);
  });
  it("rejects object references instead of applying per-use timing overrides", () => {
    const source = raw();
    source.clips.idle.frames = [{ cel: "resting", durationMs: 200 }];
    expect(() => parse(source)).toThrow(/资源无效/);
  });
  it("counts declarations plus every use against the original 2048 budget", () => {
    const source = raw();
    source.cels = Object.fromEntries(
      Array.from({ length: 1024 }, (_, i) => [`cel${i}`, frame()]),
    );
    source.clips = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        i ? `clip${i}` : "idle",
        { frames: Array(128).fill("cel0"), loop: true },
      ]),
    );
    expect(parse(source).clips.clip7.frames).toHaveLength(128);
    source.clips.extra = { frames: ["cel0"], loop: true };
    expect(() => parse(source)).toThrow(/总帧数/);
  });
  it("counts unused declarations and rejects excess before use", () => {
    const source = raw();
    source.cels = Object.fromEntries(
      Array.from({ length: 2048 }, (_, i) => [`cel${i}`, frame()]),
    );
    source.clips.idle.frames = ["cel0"];
    expect(() => parse(source)).toThrow(/总帧数/);
    declarations(source).overflow = frame();
    expect(() => parse(source)).toThrow(/总帧数/);
  });
  it.each(["clip-frames", "clips"])("does not loosen the %s limit", (kind) => {
    const source = raw();
    if (kind === "clip-frames")
      source.clips.idle.frames = Array(129).fill("resting");
    else
      for (let i = 0; i < 64; i++)
        source.clips[`clip${i}`] = { frames: ["resting"], loop: true };
    expect(() => parse(source)).toThrow(/片段/);
  });
  it("checks image closure and actual crop bounds even for unused declarations", () => {
    const source = raw();
    declarations(source).unused = {
      ...frame("hidden-atlas"),
      rect: [100, 0, 100, 100],
    };
    const parsed = parse(source),
      dimensions = { painted: { width: 100, height: 100 } };
    expect(() => validateSequenceImages(parsed, dimensions)).toThrow(
      /实际范围/,
    );
    expect(() =>
      validateSequenceImages(parsed, {
        ...dimensions,
        "hidden-atlas": { width: 100, height: 100 },
      }),
    ).toThrow(/实际范围/);
    expect(() =>
      validateSequenceImages(parsed, {
        ...dimensions,
        "hidden-atlas": { width: 200, height: 100 },
      }),
    ).not.toThrow();
    expect(() =>
      validateSequenceImages({ clips: parsed.clips }, dimensions),
    ).not.toThrow();
  });
  it("preserves absolute range indices and strict endpoints after reference expansion", () => {
    const source = raw();
    declarations(source).active = frame("active");
    declarations(source).middle = frame("middle");
    source.clips.walk = { frames: ["active"], loop: true };
    source.clips.pool = {
      frames: [frame("prefix"), "resting", "middle", "active", frame("suffix")],
      loop: false,
    };
    source.transitions = [
      {
        id: "start",
        from: "idle",
        to: "walk",
        clip: "pool",
        branches: [{ fromFrame: 0, clip: "pool", range: [1, 4] }],
      },
    ];
    const player = new SequencePlayer(parse(source));
    player.sample({ clip: "idle", t: 0 });
    expect(player.sample({ clip: "walk", t: 1 })!.frameIndex).toBe(1);
    expect(player.sample({ clip: "walk", t: 1.15 })!.frameIndex).toBe(2);
    expect(player.sample({ clip: "walk", t: 1.25 })!.frameIndex).toBe(3);
    expect(player.sample({ clip: "walk", t: 1.31 })!.clip).toBe("walk");
    source.clips.pool.frames[3] = "resting";
    expect(() => parse(source)).toThrow(/过渡分支/);
  });
});

it("production figure loads only selected referenced cels and waits without preloading unused PNGs", async () => {
  const source = raw();
  declarations(source).held = frame("selected");
  declarations(source).unused = frame("never-load");
  source.clips.held = { frames: ["held"], loop: true };
  source.clips.entry = { frames: ["resting", "held"], loop: false };
  source.transitions = [
    { id: "pickup", from: "idle", to: "held", clip: "entry" },
  ];
  const sequences = parse(source),
    requests: string[] = [],
    drawImage = vi.fn();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  class TestImage {
    src = "";
    naturalWidth = 100;
    naturalHeight = 100;
    async decode() {
      requests.push(this.src);
      if (this.src.includes("selected")) await pending;
    }
  }
  vi.stubGlobal("Image", TestImage);
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
    pickupPoint: () => null,
    preload: async () => {},
    setScheme: async () => {},
    reset() {},
    dispose() {},
    draw() {},
  };
  const figure = createSequenceFigure({
    base,
    sequences,
    scheme: "classic",
    defaultScheme: "classic",
    asset: (path) => `/authorized/${path}`,
  });
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const f = (t: number, mode: string): WhaleFrame => ({
    t,
    mode,
    look: [0, 0],
    legs: [],
    swing: 0,
    sit: 0,
  });
  const settle = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  try {
    await figure.preload();
    figure.draw(group, { eyes: [], gap: [] }, f(0, "idle"));
    expect(figure.getMotionFailure!()).toBeNull();
    expect(requests).toEqual(["/authorized/tex/painted.png"]);
    const oldDrawCount = drawImage.mock.calls.length;
    figure.draw(group, { eyes: [], gap: [] }, f(1, "held"));
    await settle();
    expect(requests).toEqual([
      "/authorized/tex/painted.png",
      "/authorized/tex/selected.png",
    ]);
    expect(drawImage).toHaveBeenCalledTimes(oldDrawCount);
    expect(figure.getMotionTransition!()?.id).toContain("assets");
    release();
    await settle();
    figure.draw(group, { eyes: [], gap: [] }, f(2, "held"));
    expect(figure.getMotionFailure!()).toBeNull();
    figure.draw(group, { eyes: [], gap: [] }, f(2.15, "held"));
    expect((drawImage.mock.calls.at(-1)![0] as TestImage).src).toBe(
      "/authorized/tex/selected.png",
    );
    expect(requests.some((url) => url.includes("never-load"))).toBe(false);
  } finally {
    release();
    figure.dispose!();
  }
});
