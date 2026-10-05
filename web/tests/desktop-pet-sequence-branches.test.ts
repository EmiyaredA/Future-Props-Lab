import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SequencePlayer } from "@features/desktop-pet/sequences/player";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import { sequencePhysicalLinkUnavailable } from "@features/desktop-pet/sequences/capabilities";
import { humanMotionUnavailable } from "@features/desktop-pet/locomotion/motionAvailability";
import { readFrameSequences } from "@features/desktop-pet/sequences/validation";
import type {
  FrameSequences,
  SequenceFrame,
  SequenceInput,
} from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";

const cel = (
  texture: string,
  i: number,
  supports: SequenceFrame["supports"],
): SequenceFrame => ({
  texture,
  rect: [i * 100, 0, 100, 100],
  durationMs: 100,
  grip: [50, 40],
  foot: [50, 80],
  head: [
    [50, 10],
    [50, 30],
  ],
  supports,
});
const fixture = (): FrameSequences => {
  const right = [
    cel("right", 0, { legBack: [6, 80], legFront: [30, 80] }),
    cel("right", 1, { legFront: [28, 80] }),
    cel("right", 2, { legFront: [26, 80], legBack: [10, 80] }),
    cel("right", 3, { legBack: [8, 80] }),
  ];
  const left = right.map((f) => ({
    ...structuredClone(f),
    texture: "left",
    supports: Object.fromEntries(
      Object.entries(f.supports!).map(([k, p]) => [k, [60 - p[0], p[1]]]),
    ),
  }));
  const idle = cel("idle", 0, { legBack: [8, 80], legFront: [30, 80] });
  const pack: FrameSequences = {
    version: 1,
    frameSize: [100, 100],
    modelBox: [0, 0, 100, 100],
    headLength: 20,
    clips: {
      idle: { frames: [idle], loop: true },
      "walk-right": { frames: right, loop: true, distancePerCycle: 8 },
      "walk-left": { frames: left, loop: true, distancePerCycle: 8 },
    },
    transitions: [],
  };
  for (const [from, to] of [
    ["idle", "walk-right"],
    ["idle", "walk-left"],
    ["walk-right", "idle"],
    ["walk-left", "idle"],
    ["walk-right", "walk-left"],
    ["walk-left", "walk-right"],
  ]) {
    const target = pack.clips[to].frames[0];
    const branches = pack.clips[from].frames.map((source, fromFrame) => {
      const name = Object.keys(source.supports!)[0] as "legFront" | "legBack",
        other = name === "legFront" ? "legBack" : "legFront",
        clip = `${from}-${to}-${fromFrame}`,
        support = source.supports![name]!;
      pack.clips[clip] = {
        loop: false,
        frames: [
          source,
          cel(clip, 0, { [name]: support }),
          cel(clip, 1, { [name]: support, [other]: target.supports![other]! }),
          cel(clip, 2, { [other]: target.supports![other]! }),
          cel(clip, 3, target.supports),
          target,
        ],
      };
      return { fromFrame, clip };
    });
    pack.transitions.push({
      id: `${from}-to-${to}`,
      from,
      to,
      clip: branches[0].clip,
      branches,
    });
  }
  return pack;
};
const physical = (
  clip: string,
  t: number,
  phase: number,
  travel: number,
  facing = 1,
): SequenceInput => ({
  clip,
  t,
  phase,
  travel: [travel * facing, 0],
  worldScale: 1,
  direction: [facing, 0],
  supportRequired: true,
});
const atPhase = (pack: FrameSequences, clip: string, phase: number) => {
  const player = new SequencePlayer(pack),
    facing = clip === "walk-left" ? -1 : 1;
  for (let i = 0; i <= phase; i++)
    expect(
      player.sample(physical(clip, i * 0.1, (i * Math.PI) / 2, i * 2, facing))!
        .motionFailure,
    ).toBeUndefined();
  return { player, facing };
};
const assertTail = (player: SequencePlayer, input: SequenceInput) => {
  let active: Record<string, number[]> = {},
    maximum = 0;
  for (let i = 0; i <= 50; i++) {
    const sample = player.sample({ ...input, t: input.t + i / 60 })!;
    expect(sample.motionFailure).toBeUndefined();
    expect(sample.scale).toBe(1);
    const next: Record<string, number[]> = {};
    for (const [name, p] of Object.entries(sample.anchors.supports)) {
      const world = p.map((v, k) => v + input.travel![k]);
      next[name] = active[name] ?? world;
      maximum = Math.max(
        maximum,
        Math.hypot(...world.map((v, k) => v - next[name][k])),
      );
    }
    if (Object.keys(active).length)
      expect(Object.keys(next).some((k) => k in active)).toBe(true);
    active = next;
  }
  expect(maximum).toBeLessThanOrEqual(1);
  expect(player.getMotionTransition()).toBeNull();
};

describe("actual-cel authored stop/turn branches", () => {
  const cases = ["walk-right", "walk-left"].flatMap((clip) =>
    [0, 1, 2, 3].map((phase) => ({ clip, phase })),
  );
  it.each(cases)(
    "holds supports while stopping $clip at cel $phase",
    ({ clip, phase }) => {
      const pack = fixture(),
        { player, facing } = atPhase(pack, clip, phase),
        input = physical("idle", 1, (phase * Math.PI) / 2, phase * 2, facing);
      expect(sequencePhysicalLinkUnavailable(pack, clip, "idle")).toBeNull();
      const sample = player.sample(input)!;
      expect(sample.clip).toBe(`${clip}-idle-${phase}`);
      expect(sample.frame).toEqual(pack.clips[clip].frames[phase]);
      assertTail(player, input);
    },
  );
  it.each(cases)(
    "uses complete opposite cels from $clip cel $phase",
    ({ clip, phase }) => {
      const pack = fixture(),
        { player, facing } = atPhase(pack, clip, phase),
        to = clip === "walk-right" ? "walk-left" : "walk-right",
        input = physical(to, 1, (phase * Math.PI) / 2, phase * 2, facing);
      input.direction = [-facing, 0];
      expect(player.sample(input)!.clip).toBe(`${clip}-${to}-${phase}`);
      assertTail(player, input);
      expect(player.sample({ ...input, t: 2 })!.frame).toEqual(
        pack.clips[to].frames[0],
      );
      const resumed = player.sample({
        ...input,
        t: 2.1,
        phase: input.phase! + Math.PI / 2,
        travel: [input.travel![0] - facing * 2, 0],
      })!;
      expect(resumed.motionFailure).toBeUndefined();
      expect(resumed.frame).toEqual(pack.clips[to].frames[1]);
    },
  );
  it.each(["missing", "duplicate", "wrong-start", "wrong-end", "loop"])(
    "rejects invalid %s branch before selection",
    (defect) => {
      const pack = fixture(),
        link = pack.transitions.find(
          (t) => t.from === "walk-right" && t.to === "idle",
        )!;
      if (defect === "missing") link.branches!.pop();
      if (defect === "duplicate") link.branches![3].fromFrame = 0;
      if (defect === "wrong-start")
        pack.clips[link.branches![3].clip].frames[0] =
          pack.clips.idle.frames[0];
      if (defect === "wrong-end") {
        const frames = pack.clips[link.branches![3].clip].frames;
        frames[frames.length - 1] = { ...frames.at(-1)!, texture: "different" };
      }
      if (defect === "loop") pack.clips[link.branches![3].clip].loop = true;
      expect(() => readFrameSequences(pack)).toThrow(/分支/);
      expect(
        sequencePhysicalLinkUnavailable(pack, "walk-right", "idle"),
      ).not.toBeNull();
      const { player } = atPhase(pack, "walk-right", 0),
        old = player.sample(physical("walk-right", 0.1, 0, 0))!,
        rejected = player.sample(physical("idle", 1, 0, 0))!;
      expect(rejected.motionFailure).toBeDefined();
      expect(rejected.frame).toEqual(old.frame);
    },
  );
  it.each([
    null,
    undefined,
    [],
    [{ fromFrame: false, clip: "idle" }],
    [{ fromFrame: -1, clip: "idle" }],
    [{ fromFrame: 0.5, clip: "idle" }],
    [{ fromFrame: 99, clip: "idle" }],
    [{ fromFrame: 0, clip: "missing" }],
  ])("rejects malformed branch namespace %j", (branches) => {
    const pack = fixture();
    (pack.transitions[0] as unknown as Record<string, unknown>).branches =
      branches;
    expect(() => readFrameSequences(pack)).toThrow(/分支/);
  });
  it("preflights support continuity inside every branch, not only endpoints", () => {
    const pack = fixture(),
      link = pack.transitions.find(
        (t) => t.from === "walk-right" && t.to === "idle",
      )!;
    pack.clips[link.branches![3].clip].frames[2] = {
      ...pack.clips[link.branches![3].clip].frames[2],
      supports: {},
    };
    expect(
      sequencePhysicalLinkUnavailable(pack, "walk-right", "idle"),
    ).toContain("实际支撑点");
  });
  it("retains an interrupted actual bridge without inventing requested-clip routing", () => {
    const pack = fixture(),
      player = new SequencePlayer(pack);
    player.sample({ clip: "idle", t: 0 });
    player.sample({ clip: "walk-right", t: 0.1, phase: 0 });
    const actual = player.sample({ clip: "walk-right", t: 0.21, phase: 0 })!,
      rejected = player.sample({ clip: "walk-left", t: 0.22, phase: 0 })!;
    expect(actual.clip).toBe("idle-walk-right-0");
    expect(rejected.motionFailure?.reason).toBe("missing-transition");
    expect(rejected.frame).toEqual(actual.frame);
  });
  it("preflights both autonomous turn directions", () => {
    const pack = fixture();
    expect(humanMotionUnavailable({ frameSequences: pack })).toBeNull();
    pack.transitions = pack.transitions.filter(
      (t) => !(t.from === "walk-left" && t.to === "walk-right"),
    );
    expect(humanMotionUnavailable({ frameSequences: pack })).toContain(
      "walk-left → walk-right",
    );
  });
});

let decoded: string[];
let deferredTexture: string | null;
let decodeWait: Promise<void> | null;
class TestImage {
  src = "";
  naturalWidth = 1000;
  naturalHeight = 100;
  async decode() {
    decoded.push(this.src);
    if (deferredTexture && this.src.endsWith(`/${deferredTexture}.png`))
      await decodeWait;
  }
}
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
const frame = (
  t: number,
  state: "idle" | "walk",
  phase: number,
  travel: number,
  facing: 1 | -1 = 1,
): WhaleFrame => ({
  t,
  mode: state,
  look: [0, 0],
  legs: [],
  swing: 0,
  sit: 0,
  locomotion: {
    state,
    facing,
    edge: null,
    phase,
    travel: { x: travel, y: 0 },
    velocity: { x: state === "walk" ? facing * 60 : 0, y: 0 },
    swing: 0,
  },
});
describe("actual Canvas branch decode and whole registration", () => {
  beforeEach(() => {
    decoded = [];
    deferredTexture = null;
    decodeWait = null;
    vi.stubGlobal("Image", TestImage);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const setup = (pack: FrameSequences, scale = 1) => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => ({
        clearRect: vi.fn(),
        drawImage,
      })) as unknown as HTMLCanvasElement["getContext"],
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
        sequences: pack,
        scheme: "classic",
        defaultScheme: "classic",
        asset: (p) => `/authorized/${p}`,
      }),
      group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    Object.defineProperty(group, "getScreenCTM", {
      value: () => ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }),
    });
    return { figure, group, drawImage };
  };
  const draw = async (h: ReturnType<typeof setup>, f: WhaleFrame) => {
    h.figure.draw(h.group, { eyes: [], gap: [] }, f);
    await flush();
    h.figure.draw(h.group, { eyes: [], gap: [] }, { ...f, t: f.t + 0.001 });
  };
  it("holds the actually painted world soles during decode and late host acknowledgements", async () => {
    const h = setup(fixture(), 1.2);
    let unlock!: () => void;
    decodeWait = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    deferredTexture = "walk-right-idle-0";
    await h.figure.preload();
    h.figure.draw(h.group, { eyes: [], gap: [] }, frame(0, "idle", 0, 0));
    await draw(h, frame(0.01, "walk", 0, 0));
    for (let i = 1; i <= 40; i++)
      h.figure.draw(
        h.group,
        { eyes: [], gap: [] },
        frame(0.01 + i * 0.02, "walk", 0, 0),
      );
    const old = h.drawImage.mock.calls.at(-1)!;
    const world = (travel: number, sole: number) =>
      travel +
      (Number(h.group.querySelector("foreignObject")!.getAttribute("x")) +
        sole) *
        1.2;
    const original = [world(0, 6), world(0, 30)];
    h.figure.draw(h.group, { eyes: [], gap: [] }, frame(0.9, "idle", 0, 0));
    await flush();
    for (const [index, travel] of [1.2, 2.4].entries()) {
      h.figure.draw(
        h.group,
        { eyes: [], gap: [] },
        frame(0.91 + index * 0.01, "idle", 0, travel),
      );
      for (const [index, sole] of [6, 30].entries())
        expect(Math.abs(world(travel, sole) - original[index])).toBeLessThan(
          1e-10,
        );
      expect(h.drawImage.mock.calls.at(-1)!.slice(0, 5)).toEqual(
        old.slice(0, 5),
      );
      expect(h.figure.getMotionFailure?.()).toBeNull();
      expect(h.figure.getMotionTransition?.()).toEqual({
        id: "sequence-assets:classic:idle",
        progress: 0,
      });
    }
    unlock();
    await flush();
    h.figure.draw(h.group, { eyes: [], gap: [] }, frame(0.95, "idle", 0, 2.4));
    expect(h.figure.getMotionFailure?.()).toBeNull();
    expect(h.figure.getMotionTransition?.()).toEqual({
      id: "walk-right-to-idle",
      progress: 0,
    });
    for (const [index, sole] of [6, 30].entries())
      expect(Math.abs(world(2.4, sole) - original[index])).toBeLessThan(1e-10);
    h.figure.dispose?.();
  });
  const renderCases = [1, -1].flatMap((facing) =>
    [0, 1, 2, 3].flatMap((phase) =>
      ["stop", "turn"].map((kind) => ({
        facing: facing as 1 | -1,
        phase,
        kind,
      })),
    ),
  );
  it.each(renderCases)(
    "loads $kind at facing $facing cel $phase and keeps Canvas supports fixed",
    async ({ facing, phase, kind }) => {
      const pack = fixture(),
        h = setup(pack),
        from = facing === 1 ? "walk-right" : "walk-left",
        to =
          kind === "stop" ? "idle" : facing === 1 ? "walk-left" : "walk-right",
        intent = kind === "stop" ? facing : (-facing as 1 | -1),
        state = kind === "stop" ? "idle" : "walk";
      await h.figure.preload();
      h.figure.draw(h.group, { eyes: [], gap: [] }, frame(0, "idle", 0, 0));
      await draw(h, frame(0.01, "walk", 0, 0, facing));
      for (let i = 1; i <= 40; i++)
        h.figure.draw(
          h.group,
          { eyes: [], gap: [] },
          frame(0.01 + i * 0.02, "walk", 0, 0, facing),
        );
      for (let i = 1; i <= phase; i++)
        h.figure.draw(
          h.group,
          { eyes: [], gap: [] },
          frame(
            0.9 + i * 0.01,
            "walk",
            (i * Math.PI) / 2,
            i * 2 * facing,
            facing,
          ),
        );
      await draw(
        h,
        frame(1, state, (phase * Math.PI) / 2, phase * 2 * facing, intent),
      );
      expect(decoded).toContain(`/authorized/tex/${from}-${to}-${phase}.png`);
      for (let other = 0; other < 4; other++)
        if (other !== phase)
          expect(decoded).not.toContain(
            `/authorized/tex/${from}-${to}-${other}.png`,
          );
      let active: Record<string, number[]> = {};
      for (let i = 1; i <= 40; i++) {
        h.figure.draw(
          h.group,
          { eyes: [], gap: [] },
          frame(
            1 + i * 0.02,
            state,
            (phase * Math.PI) / 2,
            phase * 2 * facing,
            intent,
          ),
        );
        expect(h.figure.getMotionFailure?.()).toBeNull();
        const el = h.group.querySelector("foreignObject")!,
          x = Number(el.getAttribute("x")),
          y = Number(el.getAttribute("y")),
          call = h.drawImage.mock.calls.at(-1)!,
          texture = (call[0] as TestImage).src
            .split("/")
            .at(-1)!
            .replace(".png", ""),
          rectX = call[1];
        const painted = Object.values(pack.clips)
            .flatMap((c) => c.frames)
            .find((f) => f.texture === texture && f.rect[0] === rectX)!,
          next: Record<string, number[]> = {};
        for (const [name, p] of Object.entries(painted.supports!)) {
          const world = [x + p[0] + phase * 2 * facing, y + p[1]];
          next[name] = active[name] ?? world;
          expect(
            Math.hypot(...world.map((v, k) => v - next[name][k])),
          ).toBeLessThanOrEqual(1);
        }
        active = next;
        expect(Number(el.getAttribute("width"))).toBe(100);
        expect(Number(el.getAttribute("height"))).toBe(100);
      }
      h.figure.dispose?.();
    },
  );
  it("selects recovery loading from actual entry clip and frame index", async () => {
    const pack = fixture(),
      entry = pack.transitions.find(
        (t) => t.from === "idle" && t.to === "walk-right",
      )!.branches![0].clip,
      target = pack.clips["walk-left"].frames[0];
    const branches = pack.clips[entry].frames.map((source, fromFrame) => {
      const clip = `recover-${fromFrame}`;
      pack.clips[clip] = {
        frames: [source, cel(clip, 0, source.supports), target],
        loop: false,
      };
      return { fromFrame, clip };
    });
    pack.transitions.push({
      id: "interrupt",
      from: entry,
      to: "walk-left",
      clip: branches[0].clip,
      branches,
    });
    const h = setup(pack);
    await h.figure.preload();
    h.figure.draw(h.group, { eyes: [], gap: [] }, frame(0, "idle", 0, 0));
    await draw(h, frame(0.01, "walk", 0, 0));
    h.figure.draw(h.group, { eyes: [], gap: [] }, frame(0.12, "walk", 0, 0));
    await draw(h, frame(0.13, "walk", 0, 0, -1));
    expect(decoded).toContain("/authorized/tex/recover-1.png");
    expect(decoded).not.toContain("/authorized/tex/recover-0.png");
    expect(h.figure.getMotionFailure?.()).toBeNull();
    h.figure.dispose?.();
  });
});
