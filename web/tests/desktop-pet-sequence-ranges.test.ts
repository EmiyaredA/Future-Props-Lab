import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SequencePlayer } from "@features/desktop-pet/sequences/player";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import {
  sequenceEdges,
  sequenceClipUnavailable,
  sequencePhysicalLinkUnavailable,
} from "@features/desktop-pet/sequences/capabilities";
import { readFrameSequences } from "@features/desktop-pet/sequences/validation";
import { transitionSegmentForFrame } from "@features/desktop-pet/sequences/transitions";
import type {
  FrameSequences,
  SequenceFrame,
} from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";

const cel = (texture: string): SequenceFrame => ({
  texture,
  rect: [0, 0, 100, 100],
  durationMs: 100,
  grip: [50, 40],
  foot: [30, 80],
  head: [
    [50, 10],
    [50, 30],
  ],
  supports: { legFront: [30, 80] },
});
function pack(): FrameSequences {
  const idle = cel("idle"),
    right = [cel("right0"), cel("right1")],
    left = [cel("left0"), cel("left1")];
  const sequences: FrameSequences = {
    version: 1,
    frameSize: [100, 100],
    modelBox: [0, 0, 100, 100],
    headLength: 20,
    clips: {
      idle: { loop: true, frames: [idle] },
      "walk-right": { loop: true, frames: right, distancePerCycle: 8 },
      "walk-left": { loop: true, frames: left, distancePerCycle: 8 },
    },
    transitions: [],
  };
  for (const name of ["walk-right", "walk-left"]) {
    const entry = `entry-${name}`;
    sequences.clips[entry] = {
      loop: false,
      frames: [idle, cel(entry), sequences.clips[name].frames[0]],
    };
    sequences.transitions.push({
      id: entry,
      from: "idle",
      to: name,
      clip: entry,
    });
    for (const target of [
      "idle",
      name === "walk-right" ? "walk-left" : "walk-right",
    ]) {
      const pool = `${name}-${target}-pool`;
      const frames: SequenceFrame[] = [
        { ...cel("unrelated-before"), supports: {} },
      ];
      const branches = sequences.clips[name].frames.map((source, fromFrame) => {
        const start = frames.length;
        const middle = cel(`${pool}-${fromFrame}`);
        middle.durationMs = 200;
        frames.push(source, middle, sequences.clips[target].frames[0]);
        return {
          fromFrame,
          clip: pool,
          range: [start, frames.length] as [number, number],
        };
      });
      frames.push({ ...cel("unrelated-after"), supports: {} });
      sequences.clips[pool] = { loop: false, frames };
      sequences.transitions.push({
        id: pool,
        from: name,
        to: target,
        clip: pool,
        branches,
      });
    }
  }
  return sequences;
}

describe("shared transition half-open ranges", () => {
  it.each(["walk-right", "walk-left"])(
    "keeps absolute indices and slice clocks for every %s source cel",
    (from) => {
      const sequences = pack();
      for (const sourceIndex of [0, 1])
        for (const to of [
          "idle",
          from === "walk-right" ? "walk-left" : "walk-right",
        ]) {
          const player = new SequencePlayer(sequences);
          const phase = sourceIndex * Math.PI;
          const old = player.sample({ clip: from, t: 0, phase })!;
          expect(old.frameIndex).toBe(sourceIndex);
          const first = player.sample({ clip: to, t: 1, phase })!;
          const start = 1 + sourceIndex * 3;
          expect(first.frameIndex).toBe(start);
          expect(first.frame).toEqual(old.frame);
          expect(first.clipRange).toEqual([start, start + 3]);
          const mid = player.sample({ clip: to, t: 1.15, phase })!;
          expect(mid.frameIndex).toBe(start + 1);
          expect(mid.transition?.progress).toBeCloseTo(0.375);
          const last = player.sample({ clip: to, t: 1.35, phase })!;
          expect(last.frameIndex).toBe(start + 2);
          expect(last.transition?.progress).toBeCloseTo(0.875);
          const complete = player.sample({ clip: to, t: 1.41, phase })!;
          expect(complete.clip).toBe(to);
          expect(complete.frameIndex).toBe(0);
          expect(complete.clipRange).toBeUndefined();
          expect(complete.transition).toBeUndefined();
          expect(complete.frame.texture).not.toMatch(/unrelated/);
        }
    },
  );
  it.each([
    { durations: [0.1, 0.1, 1.1] },
    { durations: [60000, 60000, 60000] },
  ])(
    "keeps range elapsed local with fractional or large prefix %j",
    ({ durations: prefixDurations }) => {
      const sequences = pack(),
        link = sequences.transitions.find(
          (t) => t.from === "walk-right" && t.to === "idle",
        )!;
      const prefix = prefixDurations.map((durationMs, i) => ({
        ...cel(`prefix${i}`),
        durationMs,
      }));
      const source = sequences.clips["walk-right"].frames[0],
        target = sequences.clips.idle.frames[0];
      const small = prefixDurations[0] === 60000 ? 0.00001 : 0.1;
      const sourceFirst = { ...source, durationMs: small },
        middle = { ...cel("middle"), durationMs: small },
        end = { ...target, durationMs: small };
      sequences.clips[link.clip].frames = [
        ...prefix,
        sourceFirst,
        middle,
        end,
        sequences.clips["walk-right"].frames[1],
        cel("other-middle"),
        target,
      ];
      link.branches = [
        { fromFrame: 0, clip: link.clip, range: [3, 6] },
        { fromFrame: 1, clip: link.clip, range: [6, 9] },
      ];
      expect(readFrameSequences(sequences)).not.toBeNull();
      const player = new SequencePlayer(sequences);
      player.sample({ clip: "walk-right", t: 0, phase: 0 });
      const first = player.sample({ clip: "idle", t: 1 })!;
      expect(first.frameIndex).toBe(3);
      expect(first.frame.texture).toBe("right0");
      const middleTime = 1 + (small * 1.5) / 1000;
      expect(player.sample({ clip: "idle", t: middleTime })!.frameIndex).toBe(
        4,
      );
      player.cancelMotionPlayback();
      const retained = player.sample({ clip: "idle", t: 2 })!;
      expect(retained.frameIndex).toBe(4);
      expect(
        player.sample({ clip: "idle", t: 2 + (small * 1.8) / 1000 })!.clip,
      ).toBe("idle");
    },
  );
  it("validates and preflights only the selected tails, not the adjacent container seams", () => {
    const sequences = pack();
    expect(readFrameSequences(sequences)).toEqual(sequences);
    expect(
      sequencePhysicalLinkUnavailable(sequences, "walk-right", "idle"),
    ).toBeNull();
    const link = sequences.transitions.find(
      (t) => t.from === "walk-right" && t.to === "idle",
    )!;
    expect(transitionSegmentForFrame(sequences, link, 1)).toEqual({
      clip: link.clip,
      start: 4,
      end: 7,
    });
    sequences.clips[link.clip].frames[5].supports = {};
    expect(
      sequencePhysicalLinkUnavailable(sequences, "walk-right", "idle"),
    ).toContain("支撑点");
  });
  it.each([
    null,
    undefined,
    [],
    [1],
    [1, 3, 4],
    [true, 4],
    [1.5, 4],
    [NaN, 4],
    [1, Infinity],
    [-1, 2],
    [4, 4],
    [4, 3],
    [1, 2],
    [1, 99],
  ])(
    "rejects malformed explicit range %j before changing the displayed cel",
    (range) => {
      const sequences = pack();
      const link = sequences.transitions.find(
        (t) => t.from === "walk-right" && t.to === "idle",
      )!;
      (link.branches![0] as unknown as Record<string, unknown>).range = range;
      expect(() => readFrameSequences(sequences)).toThrow(/分支/);
      const player = new SequencePlayer(sequences);
      const old = player.sample({ clip: "walk-right", t: 0, phase: 0 })!;
      const rejected = player.sample({ clip: "idle", t: 1 })!;
      expect(rejected.motionFailure).toBeDefined();
      expect(rejected.frame).toEqual(old.frame);
    },
  );
  it.each(["start", "end", "coverage"])(
    "does not let a %s defect hide behind valid container endpoints",
    (defect) => {
      const sequences = pack(),
        link = sequences.transitions.find(
          (t) => t.from === "walk-right" && t.to === "idle",
        )!;
      if (defect === "start") link.branches![1].range = [3, 7];
      if (defect === "end") link.branches![1].range = [4, 8];
      if (defect === "coverage") link.branches!.pop();
      expect(() => readFrameSequences(sequences)).toThrow(/分支/);
    },
  );
  it("routes an interruption from the actually painted absolute container index", () => {
    const sequences = pack(),
      stop = sequences.transitions.find(
        (t) => t.from === "walk-right" && t.to === "idle",
      )!;
    const pool = sequences.clips[stop.clip],
      recovery = "recoveries";
    const frames: SequenceFrame[] = [];
    const branches = pool.frames.map((source, fromFrame) => {
      const start = frames.length;
      frames.push(
        source,
        cel(`recovery${fromFrame}`),
        sequences.clips["walk-left"].frames[0],
      );
      return {
        fromFrame,
        clip: recovery,
        range: [start, frames.length] as [number, number],
      };
    });
    sequences.clips[recovery] = { loop: false, frames };
    sequences.transitions.push({
      id: "interrupt",
      from: stop.clip,
      to: "walk-left",
      clip: recovery,
      branches,
    });
    const player = new SequencePlayer(sequences);
    player.sample({ clip: "walk-right", t: 0, phase: Math.PI });
    player.sample({ clip: "idle", t: 1 });
    const actual = player.sample({ clip: "idle", t: 1.15 })!;
    expect(actual.frameIndex).toBe(5);
    const next = player.sample({ clip: "walk-left", t: 1.16, phase: Math.PI })!;
    expect(next.frameIndex).toBe(15);
    expect(next.frame).toEqual(actual.frame);
    expect(next.clipRange).toEqual([15, 18]);
    expect(
      player.sample({ clip: "walk-left", t: 1.41, phase: Math.PI })!.frame
        .texture,
    ).toBe("recovery5");
  });
  it("refuses an undeclared interruption and retains its actual ranged cel", () => {
    const sequences = pack(),
      player = new SequencePlayer(sequences);
    player.sample({ clip: "walk-right", t: 0, phase: Math.PI });
    player.sample({ clip: "idle", t: 1 });
    const actual = player.sample({ clip: "idle", t: 1.15 })!;
    const rejected = player.sample({ clip: "walk-left", t: 1.16, phase: 0 })!;
    expect(rejected.motionFailure?.reason).toBe("missing-transition");
    expect(rejected.frameIndex).toBe(actual.frameIndex);
    expect(rejected.frame).toEqual(actual.frame);
  });
  it("explicit cancellation retains the range position without catching up its old clock", () => {
    const player = new SequencePlayer(pack());
    player.sample({ clip: "walk-right", t: 0, phase: Math.PI });
    player.sample({ clip: "idle", t: 1 });
    const old = player.sample({ clip: "idle", t: 1.15 })!;
    player.cancelMotionPlayback();
    expect(player.sample({ clip: "idle", t: 100 })!.frame).toEqual(old.frame);
    expect(player.sample({ clip: "idle", t: 100.1 })!.frameIndex).toBe(
      old.frameIndex,
    );
  });
  it("never directly plays a shared container or advertises it as an actor action", () => {
    const sequences = pack(),
      link = sequences.transitions.find(
        (t) => t.from === "walk-right" && t.to === "idle",
      )!;
    expect(
      sequencePhysicalLinkUnavailable(sequences, "idle", link.clip),
    ).toContain("容器");
    const player = new SequencePlayer(sequences);
    const old = player.sample({ clip: "walk-right", t: 0, phase: 0 })!;
    const rejected = player.sample({ clip: link.clip, t: 1 })!;
    expect(rejected.motionFailure?.reason).toBe("transition-container");
    expect(rejected.frame).toEqual(old.frame);
    expect(
      new SequencePlayer(sequences).sample({ clip: link.clip, t: 0 }),
    ).toBeNull();
  });
  it.each(["side-left", "held", "walk-right"])(
    "does not expose a valid supported container named %s as an ordinary action",
    (name) => {
      const sequences = pack(),
        link = sequences.transitions.find(
          (t) => t.from === "walk-left" && t.to === "idle",
        )!;
      const old = link.clip;
      // Use an independently named source action so the canonical pool name has no destination references.
      if (name === "walk-right") {
        sequences.clips.source = sequences.clips["walk-right"];
        delete sequences.clips["walk-right"];
        for (const transition of sequences.transitions) {
          if (transition.from === "walk-right") transition.from = "source";
          if (transition.to === "walk-right") transition.to = "source";
        }
      }
      sequences.clips[name] = sequences.clips[old];
      delete sequences.clips[old];
      for (const transition of sequences.transitions) {
        if (transition.clip === old) transition.clip = name;
        for (const branch of transition.branches ?? [])
          if (branch.clip === old) branch.clip = name;
      }
      if (name === "side-left")
        for (const frame of sequences.clips[name].frames) {
          frame.contacts = { left: [30, 80] };
          frame.supports = { legFront: [30, 80] };
        }
      expect(readFrameSequences(sequences)).not.toBeNull();
      expect(sequenceClipUnavailable(sequences, name)).toContain("容器");
      if (name === "side-left")
        expect(sequenceEdges(sequences)).not.toContain("left");
      const player = new SequencePlayer(sequences);
      player.sample({ clip: "walk-left", t: 0, phase: 0 });
      expect(
        player.sample({ clip: name, t: 1, phase: 0 })!.motionFailure?.reason,
      ).toBe("transition-container");
    },
  );
  it.each(["idle", "target"])(
    "rejects a container as %s at the resource boundary",
    (destination) => {
      const sequences = pack(),
        link = sequences.transitions.find(
          (t) => t.from === "walk-right" && t.to === "idle",
        )!;
      const container = link.clip;
      if (destination === "target")
        sequences.transitions.push({
          id: "naked",
          from: "idle",
          to: container,
          clip: container,
        });
      else {
        const source = cel("same");
        sequences.clips.idle = {
          loop: false,
          frames: [cel("other"), source, source],
        };
        sequences.clips["walk-right"].frames = [source];
        sequences.clips["walk-left"].frames = [source];
        sequences.transitions = [
          {
            id: "container-idle",
            from: "walk-right",
            to: "walk-left",
            clip: "idle",
            branches: [{ fromFrame: 0, clip: "idle", range: [1, 3] }],
          },
        ];
      }
      expect(() => readFrameSequences(sequences)).toThrow(/容器/);
    },
  );
  it("releases support only on the selected airborne endpoint, not the neighboring tail", () => {
    const sequences = pack(),
      airborne = { ...cel("flight"), supports: {} };
    sequences.clips["glide-right"] = { loop: true, frames: [airborne] };
    const pool = [
      cel("unrelated"),
      sequences.clips["walk-right"].frames[0],
      cel("depart0"),
      airborne,
      sequences.clips["walk-right"].frames[1],
      cel("depart1"),
      airborne,
      cel("unrelated"),
    ];
    sequences.clips.departure = { loop: false, frames: pool };
    sequences.transitions.push({
      id: "depart",
      from: "walk-right",
      to: "glide-right",
      clip: "departure",
      branches: [
        { fromFrame: 0, clip: "departure", range: [1, 4] },
        { fromFrame: 1, clip: "departure", range: [4, 7] },
      ],
    });
    const player = new SequencePlayer(sequences);
    const input = {
      phase: 0,
      travel: [0, 0] as [number, number],
      supportRequired: true,
      releaseSupportAtExit: true,
    };
    player.sample({ ...input, clip: "walk-right", t: 0 });
    player.sample({ ...input, clip: "glide-right", t: 1 });
    const released = player.sample({ ...input, clip: "glide-right", t: 1.25 })!;
    expect(released.frameIndex).toBe(3);
    expect(released.motionFailure).toBeUndefined();
    expect(released.frame).toEqual(airborne);
    expect(
      player.sample({ ...input, clip: "glide-right", t: 1.31 })!.clip,
    ).toBe("glide-right");
  });
  it("does not fit a bad timed support registration inside a selected range", () => {
    const sequences = pack(),
      link = sequences.transitions.find(
        (t) => t.from === "walk-right" && t.to === "idle",
      )!;
    sequences.clips[link.clip].frames[2].supports = { legFront: [35, 80] };
    const player = new SequencePlayer(sequences),
      input = {
        phase: 0,
        travel: [0, 0] as [number, number],
        worldScale: 1.25,
        supportRequired: true,
      };
    player.sample({ ...input, clip: "walk-right", t: 0 });
    player.sample({ ...input, clip: "idle", t: 1 });
    const rejected = player.sample({ ...input, clip: "idle", t: 1.15 })!;
    expect(rejected.motionFailure?.reason).toBe(
      "support-registration-mismatch",
    );
    expect(rejected.anchors.supports.legFront).toEqual([30, 80]);
  });
  it("preserves absent-range legacy single-cel branches", () => {
    const sequences = pack(),
      source = sequences.clips.idle.frames[0];
    sequences.clips.stand = { loop: true, frames: [source] };
    sequences.clips.same = { loop: false, frames: [source] };
    sequences.transitions.push({
      id: "legacy",
      from: "idle",
      to: "stand",
      clip: "same",
      branches: [{ fromFrame: 0, clip: "same" }],
    });
    expect(readFrameSequences(sequences)).not.toBeNull();
    const player = new SequencePlayer(sequences);
    player.sample({ clip: "idle", t: 0 });
    expect(
      player.sample({ clip: "stand", t: 1 })!.motionFailure,
    ).toBeUndefined();
  });
});

// Synthetic painted contacts with a real handoff: source support is released
// only after a second target support has been established.
function physicalPack(): FrameSequences {
  const sequences = pack();
  for (const id of ["idle", "walk-right", "walk-left"]) {
    const direction = id === "walk-left" ? -1 : 1;
    sequences.clips[id].frames.forEach((frame, i) => {
      frame.supports = {
        legFront: [30 - direction * 4 * i, 80],
        legBack: [10 - direction * 4 * i, 80],
      };
    });
  }
  for (const link of sequences.transitions) {
    if (!link.branches) continue;
    const frames: SequenceFrame[] = [
      { ...cel("unrelated-before"), supports: {} },
    ];
    for (const branch of link.branches) {
      const source = sequences.clips[link.from].frames[branch.fromFrame];
      const target = sequences.clips[link.to].frames[0];
      const old = source.supports!.legFront!,
        fresh = target.supports!.legBack!;
      const middle = (i: number, supports: SequenceFrame["supports"]) => ({
        ...cel(`${link.clip}-${branch.fromFrame}-${i}`),
        supports,
      });
      const start = frames.length;
      frames.push(
        source,
        middle(0, { legFront: old }),
        middle(1, { legFront: old, legBack: fresh }),
        middle(2, { legBack: fresh }),
        middle(3, target.supports),
        target,
      );
      branch.range = [start, frames.length];
    }
    frames.push({ ...cel("unrelated-after"), supports: {} });
    sequences.clips[link.clip].frames = frames;
  }
  return sequences;
}

let decoded: string[];
let waitTexture: string | null;
let wait: Promise<void> | null;
class ImageStub {
  src = "";
  naturalWidth = 100;
  naturalHeight = 100;
  async decode() {
    decoded.push(this.src);
    if (waitTexture && this.src.endsWith(`/${waitTexture}.png`)) await wait;
  }
}
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const motion = (
  t: number,
  state: "idle" | "walk",
  phase: number,
  travel = 0,
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
describe("actual Canvas ranged decode and registration", () => {
  beforeEach(() => {
    decoded = [];
    waitTexture = null;
    wait = null;
    vi.stubGlobal("Image", ImageStub);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function setup(sequences: FrameSequences) {
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
      sequences,
      scheme: "classic",
      defaultScheme: "classic",
      asset: (p) => `/authorized/${p}`,
    });
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    Object.defineProperty(group, "getScreenCTM", {
      value: () => ({ a: 1.25, b: 0, c: 0, d: 1.25, e: 0, f: 0 }),
    });
    return { figure, group, drawImage };
  }
  const draw = (h: ReturnType<typeof setup>, f: WhaleFrame) =>
    h.figure.draw(h.group, { eyes: [], gap: [] }, f);
  async function start(h: ReturnType<typeof setup>, facing: 1 | -1 = 1) {
    await h.figure.preload();
    draw(h, motion(0, "idle", 0));
    draw(h, motion(0.01, "walk", 0, 0, facing));
    await flush();
    for (let i = 0; i < 30; i++)
      draw(h, motion(0.02 + i * 0.02, "walk", 0, 0, facing));
  }
  it.each([1, -1] as const)(
    "decodes only the selected tail and never adjacent shared cells at facing %s",
    async (facing) => {
      const sequences = physicalPack(),
        h = setup(sequences),
        from = facing === 1 ? "walk-right" : "walk-left";
      await start(h, facing);
      // A host-confirmed half-cycle also changes the visible loop cel.
      draw(h, motion(0.7, "walk", Math.PI, facing * 5, facing));
      expect(h.figure.getMotionFailure?.()).toBeNull();
      draw(h, motion(0.71, "idle", Math.PI, facing * 5, facing));
      await flush();
      draw(h, motion(0.72, "idle", Math.PI, facing * 5, facing));
      const pool = `${from}-idle-pool`;
      expect(decoded).toContain(`/authorized/tex/${pool}-1-0.png`);
      expect(decoded).not.toContain(`/authorized/tex/${pool}-0-0.png`);
      expect(decoded.some((path) => path.includes("unrelated"))).toBe(false);
      let active: Record<string, number[]> = {};
      for (let i = 1; i <= 40; i++) {
        draw(h, motion(0.72 + i * 0.02, "idle", Math.PI, facing * 5, facing));
        const call = h.drawImage.mock.calls.at(-1)!;
        const texture = (call[0] as ImageStub).src
          .split("/")
          .at(-1)!
          .replace(".png", "");
        const painted = Object.values(sequences.clips)
          .flatMap((clip) => clip.frames)
          .find((cel) => cel.texture === texture)!;
        const element = h.group.querySelector("foreignObject")!;
        const x = Number(element.getAttribute("x")),
          y = Number(element.getAttribute("y"));
        const next: Record<string, number[]> = {};
        for (const [name, point] of Object.entries(painted.supports!)) {
          const world = [
            facing * 5 + (x + point[0]) * 1.25,
            (y + point[1]) * 1.25,
          ];
          next[name] = active[name] ?? world;
          expect(
            Math.hypot(...world.map((v, k) => v - next[name][k])),
          ).toBeLessThanOrEqual(1);
        }
        if (Object.keys(active).length)
          expect(Object.keys(next).some((key) => key in active)).toBe(true);
        active = next;
        expect(call.slice(3)).toEqual([100, 100, 0, 0, 100, 100]);
      }
      expect(h.figure.getMotionFailure?.()).toBeNull();
      const textures = h.drawImage.mock.calls.map(
        (call) => (call[0] as ImageStub).src,
      );
      expect(textures.some((path) => path.includes(`${pool}-0-0.png`))).toBe(
        false,
      );
      expect(textures.at(-1)).toBe("/authorized/tex/idle.png");
      const box = h.group.querySelector("foreignObject")!;
      expect(box.getAttribute("width")).toBe("100");
      expect(box.getAttribute("height")).toBe("100");
      h.figure.dispose?.();
    },
  );
  it("loads an interrupted tail from the actual absolute shared-container cel", async () => {
    const sequences = physicalPack(),
      stop = sequences.transitions.find(
        (t) => t.from === "walk-right" && t.to === "idle",
      )!;
    const source = sequences.clips[stop.clip],
      target = sequences.clips["walk-left"].frames[0];
    const frames: SequenceFrame[] = [];
    const branches = source.frames.map((first, fromFrame) => {
      const name =
        (Object.keys(first.supports ?? {})[0] as "legFront" | "legBack") ||
        "legFront";
      const other = name === "legFront" ? "legBack" : "legFront";
      const old = first.supports?.[name] ?? [30, 80];
      const fresh = target.supports![other]!;
      const start = frames.length;
      const middle = (i: number, supports: SequenceFrame["supports"]) => ({
        ...cel(`recover-${fromFrame}-${i}`),
        supports,
      });
      frames.push(
        first,
        middle(0, { [name]: old }),
        middle(1, { [name]: old, [other]: fresh }),
        middle(2, { [other]: fresh }),
        middle(3, target.supports),
        target,
      );
      return {
        fromFrame,
        clip: "recoveries",
        range: [start, frames.length] as [number, number],
      };
    });
    sequences.clips.recoveries = { loop: false, frames };
    sequences.transitions.push({
      id: "recover",
      from: stop.clip,
      to: "walk-left",
      clip: "recoveries",
      branches,
    });
    expect(readFrameSequences(sequences)).not.toBeNull();
    const h = setup(sequences);
    await start(h);
    draw(h, motion(0.7, "walk", Math.PI, 5));
    draw(h, motion(0.71, "idle", Math.PI, 5));
    await flush();
    draw(h, motion(0.72, "idle", Math.PI, 5));
    // Stop tail starts at absolute index 7; its next complete cel is 8.
    for (let i = 1; i <= 6; i++)
      draw(h, motion(0.72 + i * 0.02, "idle", Math.PI, 5));
    expect((h.drawImage.mock.calls.at(-1)![0] as ImageStub).src).toBe(
      "/authorized/tex/walk-right-idle-pool-1-0.png",
    );
    draw(h, motion(0.85, "walk", Math.PI, 5, -1));
    await flush();
    draw(h, motion(0.86, "walk", Math.PI, 5, -1));
    expect(decoded).toContain("/authorized/tex/recover-8-0.png");
    expect(decoded).not.toContain("/authorized/tex/recover-1-0.png");
    expect(decoded).not.toContain("/authorized/tex/recover-0-0.png");
    const box = h.group.querySelector("foreignObject")!;
    const original = 5 + (Number(box.getAttribute("x")) + 26) * 1.25;
    draw(h, motion(0.87, "walk", Math.PI, 6.25, -1));
    expect(6.25 + (Number(box.getAttribute("x")) + 26) * 1.25).toBeCloseTo(
      original,
      10,
    );
    expect(h.figure.getMotionFailure?.()).toBeNull();
    h.figure.dispose?.();
  });
  it("keeps actual world support fixed while a ranged tail decode is pending and a late ACK arrives", async () => {
    const h = setup(physicalPack());
    await start(h);
    const box = h.group.querySelector("foreignObject")!;
    const sole = (travel: number) =>
      travel + (Number(box.getAttribute("x")) + 30) * 1.25;
    const original = sole(0),
      old = h.drawImage.mock.calls.at(-1)!;
    let resolve!: () => void;
    wait = new Promise<void>((done) => {
      resolve = done;
    });
    waitTexture = "walk-right-idle-pool-0-0";
    draw(h, motion(0.7, "idle", 0));
    await flush();
    draw(h, motion(0.71, "idle", 0, 1.25));
    expect(sole(1.25)).toBeCloseTo(original, 10);
    expect(h.drawImage.mock.calls.at(-1)!.slice(0, 5)).toEqual(old.slice(0, 5));
    expect(h.figure.getMotionTransition?.()?.progress).toBe(0);
    resolve();
    await flush();
    draw(h, motion(0.72, "idle", 0, 1.25));
    expect(sole(1.25)).toBeCloseTo(original, 10);
    expect(h.figure.getMotionTransition?.()).toEqual({
      id: "walk-right-idle-pool",
      progress: 0,
    });
    h.figure.dispose?.();
  });
});
