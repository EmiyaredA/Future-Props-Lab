import { createRef } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createPet } from "@features/desktop-pet/whale-vendor/pet-core.js";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import { WhaleRenderer } from "@features/desktop-pet/WhaleRenderer";
import type { PetRendererHandle } from "@features/desktop-pet/PetRenderer";
import type { PetDocument } from "@features/desktop-pet/api";
import type {
  FrameSequences,
  SequenceFrame,
} from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";
import type { PetMotionFrame } from "@platform/petMotion";
import { motionIssue } from "@features/desktop-pet/locomotion/usePetLocomotion";

const factory = vi.hoisted(() => ({ human: vi.fn() }));
vi.mock("@features/desktop-pet/humanFigure", () => ({
  createHumanFigure: factory.human,
}));
let requests: string[];
let paint: ReturnType<typeof vi.fn>;
let raf: FrameRequestCallback | null;
let rafNow: number;
class Raster {
  src = "";
  naturalWidth = 100;
  naturalHeight = 200;
  async decode() {
    requests.push(this.src);
  }
}
const cel = (texture: string): SequenceFrame => ({
  texture,
  rect: [0, 0, 100, 200],
  durationMs: 100,
  grip: [50, 70],
  foot: [50, 190],
  head: [
    [50, 10],
    [50, 50],
  ],
});
function pack(): FrameSequences {
  const idle = cel("idle"),
    held = cel("held"),
    hop = cel("hop");
  const sequences: FrameSequences = {
    version: 1,
    frameSize: [100, 200],
    modelBox: [20, 30, 50, 100],
    headLength: 20,
    clips: {
      idle: { frames: [idle, cel("idle2")], loop: true },
      held: { frames: [held], loop: true },
      hop: { frames: [hop], loop: false },
      nod: { frames: [cel("nod")], loop: false },
      turn: { frames: [cel("turn")], loop: false },
      pickup: { frames: [idle, held], loop: false },
      drop: { frames: [held, idle], loop: false },
    },
    transitions: [
      { id: "pickup", from: "idle", to: "held", clip: "pickup" },
      { id: "drop", from: "held", to: "idle", clip: "drop" },
    ],
  };
  // Fully drawable named atlases even have exact legal idle entry/return cels;
  // absence of a bridge must not be the reason the reaction is prevented.
  for (const id of ["hop", "nod", "turn"]) {
    const target = sequences.clips[id].frames[0];
    sequences.clips[`entry-${id}`] = { loop: false, frames: [idle, target] };
    sequences.clips[`exit-${id}`] = { loop: false, frames: [target, idle] };
    sequences.transitions.push(
      { id: `entry-${id}`, from: "idle", to: id, clip: `entry-${id}` },
      { id: `exit-${id}`, from: id, to: "idle", clip: `exit-${id}` },
    );
  }
  return sequences;
}
function base(): LoadedWhaleFigure {
  return {
    fixedScale: true,
    scheme: "classic",
    motionFacing: () => 1,
    pickupPoint: () => [45, 65],
    preload: async () => undefined,
    setScheme: async () => undefined,
    reset: () => undefined,
    draw: (group) => {
      if (!group.firstChild) group.append(document.createElement("canvas"));
    },
  };
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
beforeEach(() => {
  requests = [];
  paint = vi.fn();
  raf = null;
  rafNow = 0;
  vi.spyOn(performance, "now").mockImplementation(() => rafNow);
  vi.stubGlobal("Image", Raster);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    raf = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    kind: string,
  ) =>
    kind === "2d"
      ? { drawImage: paint, clearRect: vi.fn() }
      : null) as unknown as HTMLCanvasElement["getContext"]);
  factory.human.mockReset();
  factory.human.mockResolvedValue(base());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function stage() {
  const figure = createSequenceFigure({
    base: base(),
    sequences: pack(),
    scheme: "classic",
    defaultScheme: "classic",
    asset: (path) => `/authorized/${path}`,
  });
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const viewport = { x: -1000.2, y: 468.5 };
  const frames: WhaleFrame[] = [];
  const drawn = figure.draw.bind(figure);
  figure.draw = (g, face, frame) => {
    frames.push(frame);
    drawn(g, face, frame);
  };
  const pet = createPet(
    {
      petG: group,
      shadowEl: document.createElementNS(
        "http://www.w3.org/2000/svg",
        "ellipse",
      ),
      fxG: document.createElementNS("http://www.w3.org/2000/svg", "g"),
    },
    {
      figure,
      roam: "off",
      walkInPlace: true,
      startX: 140,
      viewportOrigin: () => viewport,
      bounds: () => ({ W: 300, H: 400, floorY: 380, S: 0.7933 }),
      sfx: new Proxy({}, { get: () => () => undefined }),
    },
  );
  await figure.preload();
  pet.render();
  const root = () => {
    const [x, y] = group
      .getAttribute("transform")!
      .match(/^translate\(([^)]+)\)/)![1]
      .split(" ")
      .map(Number);
    return [viewport.x + x, viewport.y + y];
  };
  const tick = (dt = 1 / 60) => {
    pet.step(dt);
    pet.render();
  };
  return { figure, pet, frames, viewport, group, root, tick };
}

test.each([30, 60])(
  "baseline public legacy hop really moves the retained source root at %sfps",
  async (fps) => {
    const s = await stage();
    const initial = s.root();
    s.pet.replaceReaction("hop", "surprised", false);
    let drift = 0;
    const observedFailures = new Set<string | null>();
    for (let i = 0; i < fps; i++) {
      s.pet.setLocomotion({
        state: "idle",
        facing: 1,
        edge: null,
        phase: 0,
        velocity: { x: 0, y: 0 },
        swing: 0,
      });
      s.tick(1 / fps);
      drift = Math.max(drift, Math.abs(s.root()[1] - initial[1]));
      observedFailures.add(s.figure.getMotionFailure!());
    }
    expect(drift).toBeGreaterThan(1);
    expect(observedFailures.has("sequence:missing-clip")).toBe(true);
    expect(paint.mock.calls.at(-1)![0].src).toContain("idle.png");
  },
);

test.each([30, 60])(
  "public rejection preserves cel/root and clocks without decoding a valid same-named hop atlas at %sfps",
  async (fps) => {
    const s = await stage(),
      initial = s.root(),
      count = paint.mock.calls.length;
    s.pet.replaceRejectedReaction(
      "hop",
      "happy",
      false,
      "unsupported-motion-resource",
    );
    for (let i = 0; i < fps * 3; i++) {
      s.pet.setLocomotion(null);
      s.tick(1 / fps);
      expect(s.root()).toEqual(initial);
    }
    expect(paint).toHaveBeenCalledTimes(count);
    expect(requests.some((path) => path.endsWith("/hop.png"))).toBe(false);
    expect(s.frames[1].face).toBe("happy");
    expect(s.frames.at(-1)!.face).toBe("neutral");
    expect(s.frames.at(-1)!.t).toBeCloseTo(3);
    expect(s.figure.getMotionFailure!()).toBe("unsupported-motion-resource");
    s.figure.cancelMotionPlayback!();
    s.tick();
    expect(s.figure.getMotionFailure!()).toBe("unsupported-motion-resource");
    s.pet.replaceReaction(null, null, true);
    s.tick();
    expect(s.figure.getMotionFailure!()).toBeNull();
    expect(s.pet.getReactionFailure()).toBeNull();
    expect(paint).toHaveBeenCalledTimes(count);
    expect(s.root()).toEqual(initial);
    expect(s.frames.at(-1)!.t).toBeGreaterThan(3);
    expect(s.figure.getMotionTransition?.()).toBeNull();
    // Rejection did not advance the painted cel clock or cause a catchup to idle2.
    expect(paint.mock.calls.at(-1)![0].src).toContain("idle.png");
  },
);

test("rejected reaction still permits actual manual root movement and confirmed placement followed by normal easing", async () => {
  const s = await stage();
  s.pet.replaceRejectedReaction(
    "hop",
    "happy",
    true,
    "unsupported-motion-resource",
  );
  const held: PetMotionFrame = {
    state: "held",
    facing: 1,
    edge: null,
    phase: 0,
    velocity: { x: 0, y: 0 },
    swing: 0,
    grip: { x: 150, y: 280 },
  };
  s.pet.setLocomotion(held);
  for (let i = 0; i < 30; i++) {
    s.tick();
    await settle();
  }
  expect(paint.mock.calls.at(-1)![0].src).toContain("held.png");
  const beforeMove = s.root();
  s.pet.setLocomotion({ ...held, grip: { x: 180, y: 280 } });
  s.tick();
  expect(s.root()[0] - beforeMove[0]).toBeCloseTo(30);
  const beforeReceipt = s.root();
  expect(s.pet.beginPlacementHandoff(4)).toBe(true);
  s.viewport.y += 20;
  s.tick();
  expect(s.root()).toEqual(beforeReceipt);
  const releaseAt = s.frames.at(-1)!.t;
  s.pet.commitPlacementHandoff(4);
  s.pet.setLocomotion(null);
  s.tick();
  expect(Math.abs(s.root()[1] - beforeReceipt[1])).toBeLessThan(0.4);
  const roots = [s.root()[1]];
  for (let i = 0; i < 20; i++) {
    s.tick();
    roots.push(s.root()[1]);
    const fraction = Math.min(1, (s.frames.at(-1)!.t - releaseAt) / 0.24);
    const eased = fraction * fraction * (3 - 2 * fraction);
    expect(
      Math.abs(
        s.root()[1] -
          (beforeReceipt[1] * (1 - eased) + (s.viewport.y + 380) * eased),
      ),
    ).toBeLessThan(0.11);
  }
  expect(roots.at(-1)).not.toBe(beforeReceipt[1]);
  expect(s.figure.getMotionFailure!()).toBe("unsupported-motion-resource");
  s.pet.replaceReaction("stand", null, false);
  s.tick();
  await settle();
  s.tick();
  expect(s.pet.getReactionFailure()).toBeNull();
});

test("genuine physical support error has priority over the retained missing-reaction warning", async () => {
  const s = await stage();
  s.pet.replaceRejectedReaction(
    "hop",
    null,
    true,
    "unsupported-motion-resource",
  );
  // Direct validated dimensions; physical support declaration is intentionally absent.
  const frames = pack();
  frames.clips["walk-right"] = {
    loop: true,
    distancePerCycle: 60,
    frames: [cel("walk")],
  };
  const figure = createSequenceFigure({
    base: base(),
    sequences: frames,
    scheme: "classic",
    defaultScheme: "classic",
    asset: (path) => path,
  });
  figure.rejectReactionPlayback!("unsupported-motion-resource");
  figure.draw(
    s.group,
    { eyes: [], gap: [] },
    {
      ...s.frames[0],
      locomotion: {
        state: "walk",
        facing: 1,
        edge: null,
        phase: 0,
        velocity: { x: 60, y: 0 },
        swing: 0,
        travel: { x: 0, y: 0 },
      },
    },
  );
  expect(figure.getMotionFailure!()).toBe("sequence:missing-support");
  figure.acceptReactionPlayback!();
  expect(figure.getMotionFailure!()).toBe("sequence:missing-support");
  expect(motionIssue(figure.getMotionFailure!()!).severity).toBe("error");
});

function documentFor(
  sequences: boolean,
  motion: string | null,
  version = 1,
): PetDocument {
  return {
    revision: 1,
    sourceRevision: 1,
    sourceType: "coopanion-whale",
    character: null,
    whaleModel: {
      rigProfile: "human-chibi",
      schemes: [{ id: "classic" }],
      ...(sequences ? { frameSequences: pack() } : { motionRig: { version } }),
    },
    whaleAssets: Object.fromEntries(
      ["idle", "idle2", "hop", "nod", "turn", "held"].map((id) => [
        `tex/${id}.png`,
        id,
      ]),
    ),
    assetUrls: Object.fromEntries(
      ["idle", "idle2", "hop", "nod", "turn", "held"].map((id) => [
        id,
        `/authorized/${id}.png`,
      ]),
    ),
    config: {
      schemaVersion: 2,
      skins: [],
      activeSkinId: null,
      schemeId: "classic",
      events: {
        click: { motionId: motion, expressionId: null, sound: "none" },
        idle: { motionId: null, expressionId: null, sound: "none" },
      },
      habits: {
        size: 220,
        roam: "off",
        draggable: true,
        edgeClimbing: true,
        highGliding: true,
        sound: false,
        bubbles: false,
        hoverActions: [],
      },
    },
  };
}
const advance = async (seconds: number) => {
  await act(async () => {
    for (let i = 0; i < Math.ceil(seconds * 60); i++) {
      rafNow += 1000 / 60;
      raf?.(rafNow);
      await settle();
    }
  });
};

test.each([
  [true, "hop", "unsupported-motion-resource", "warning"],
  [true, "nod", "unsupported-motion-resource", "warning"],
  [true, "turn", "unsupported-motion-resource", "warning"],
  [false, "hop", "unsupported-motion-resource", "warning"],
  [true, "toString", "unknown-motion-resource", "error"],
  [true, "constructor", "unknown-motion-resource", "error"],
] as const)(
  "production renderer structurally rejects sequence=%s motion=%s with %s",
  async (sequence, motion, code, severity) => {
    const ref = createRef<PetRendererHandle>();
    const doc = documentFor(sequence, motion);
    const view = render(<WhaleRenderer ref={ref} document={doc} />);
    await waitFor(() => expect(factory.human).toHaveBeenCalledTimes(1));
    await advance(0.05);
    view.rerender(
      <WhaleRenderer
        ref={ref}
        document={doc}
        eventName="click"
        reactionKey={1}
      />,
    );
    await advance(0.5);
    expect(ref.current!.motionFailure!()).toBe(code);
    expect(motionIssue(ref.current!.motionFailure!()!).severity).toBe(severity);
    expect(requests.some((path) => path.endsWith(`/${motion}.png`))).toBe(
      false,
    );
    view.rerender(
      <WhaleRenderer
        ref={ref}
        document={doc}
        eventName="idle"
        reactionKey={2}
      />,
    );
    await advance(0.05);
    expect(ref.current!.motionFailure!()).toBeNull();
  },
);

test("invalid complete sequence description remains a load error and never activates legacy physics", async () => {
  const doc = documentFor(true, "hop");
  doc.whaleModel!.frameSequences = { version: 12 };
  const view = render(<WhaleRenderer document={doc} eventName="click" />);
  await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
  expect(factory.human).not.toHaveBeenCalled();
  expect(paint).not.toHaveBeenCalled();
});

test("full event timer continues through a rejected reaction and restores valid idle after1800ms", async () => {
  const ref = createRef<PetRendererHandle>();
  const doc = documentFor(true, "hop");
  const view = render(<WhaleRenderer ref={ref} document={doc} />);
  await waitFor(() => expect(factory.human).toHaveBeenCalledTimes(1));
  await advance(0.05);
  view.rerender(
    <WhaleRenderer
      ref={ref}
      document={doc}
      eventName="click"
      reactionKey={1}
      playbackMode="event"
    />,
  );
  await advance(1.7);
  expect(ref.current!.motionFailure!()).toBe("unsupported-motion-resource");
  await advance(0.2);
  expect(ref.current!.motionFailure!()).toBeNull();
});

test("legacy whale without a motion rig still accepts supported hop physics", async () => {
  const ref = createRef<PetRendererHandle>();
  const doc = documentFor(false, "hop");
  delete doc.whaleModel!.motionRig;
  const source = base();
  const draw = vi.fn(source.draw);
  source.draw = draw;
  factory.human.mockResolvedValue(source);
  render(<WhaleRenderer ref={ref} document={doc} eventName="click" />);
  await waitFor(() => expect(factory.human).toHaveBeenCalledTimes(1));
  await advance(0.3);
  expect(draw.mock.calls.some(([, , frame]) => frame.mode === "air")).toBe(
    true,
  );
  expect(ref.current!.motionFailure!()).toBeNull();
});

test("chat gesture selection cannot bypass the complete-cel rejection gate", async () => {
  const ref = createRef<PetRendererHandle>();
  const doc = documentFor(true, null);
  const view = render(<WhaleRenderer ref={ref} document={doc} />);
  await waitFor(() => expect(factory.human).toHaveBeenCalledTimes(1));
  await advance(0.05);
  view.rerender(
    <WhaleRenderer
      ref={ref}
      document={doc}
      eventName="chatSpeaking"
      reactionKey={1}
    />,
  );
  await advance(0.5);
  expect(ref.current!.motionFailure!()).toBe("unsupported-motion-resource");
  expect(requests.some((path) => path.endsWith("/nod.png"))).toBe(false);
});

test("cancelling a manual grab after rejection preserves the existing eased release rather than freezing or snapping", async () => {
  const s = await stage();
  s.pet.replaceRejectedReaction(
    "hop",
    null,
    true,
    "unsupported-motion-resource",
  );
  s.pet.setLocomotion({
    state: "held",
    facing: 1,
    edge: null,
    phase: 0,
    velocity: { x: 0, y: 0 },
    swing: 0,
    grip: { x: 180, y: 280 },
  });
  for (let i = 0; i < 30; i++) {
    s.tick();
    await settle();
  }
  const start = s.root()[1],
    releaseAt = s.frames.at(-1)!.t;
  // The cancellation path has no final placement RPC and leaves the viewport unchanged.
  s.pet.setLocomotion(null);
  for (let i = 0; i < 20; i++) {
    s.tick();
    const fraction = Math.min(1, (s.frames.at(-1)!.t - releaseAt) / 0.24);
    const eased = fraction * fraction * (3 - 2 * fraction);
    expect(
      Math.abs(
        s.root()[1] - (start * (1 - eased) + (s.viewport.y + 380) * eased),
      ),
    ).toBeLessThan(0.11);
  }
  const settled = s.root();
  s.tick();
  expect(s.root()).toEqual(settled);
  expect(s.figure.getMotionFailure!()).toBe("unsupported-motion-resource");
});

test("a manual asset decode error stays above the resource warning and acceptance cannot erase it", async () => {
  class BrokenHeld extends Raster {
    async decode() {
      if (this.src.endsWith("/held.png"))
        throw new Error("selected-held-decode-failed");
      await super.decode();
    }
  }
  vi.stubGlobal("Image", BrokenHeld);
  const s = await stage();
  s.pet.replaceRejectedReaction(
    "hop",
    null,
    true,
    "unsupported-motion-resource",
  );
  s.pet.setLocomotion({
    state: "held",
    facing: 1,
    edge: null,
    phase: 0,
    velocity: { x: 0, y: 0 },
    swing: 0,
    grip: { x: 150, y: 280 },
  });
  s.tick();
  await settle();
  expect(s.figure.getMotionFailure!()).toBe("selected-held-decode-failed");
  s.pet.replaceReaction(null, null, true);
  expect(s.figure.getMotionFailure!()).toBe("selected-held-decode-failed");
  expect(motionIssue(s.figure.getMotionFailure!()!).severity).toBe("error");
});

test("a first rejected selection without any painted sequence cel uses safe base standing without requesting the named atlas", async () => {
  const source = base(),
    draw = vi.fn(source.draw);
  source.draw = draw;
  const figure = createSequenceFigure({
    base: source,
    sequences: pack(),
    scheme: "classic",
    defaultScheme: "classic",
    asset: (path) => path,
  });
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  figure.rejectReactionPlayback!("unsupported-motion-resource");
  figure.draw(
    group,
    { eyes: [], gap: [] },
    { t: 10, mode: "hop", sit: 0, swing: 0, look: [0, 0], legs: [] },
  );
  expect(draw).toHaveBeenCalledTimes(1);
  expect(draw.mock.calls[0][2].mode).toBe("idle");
  expect(requests).toEqual([]);
  expect(paint).not.toHaveBeenCalled();
  expect(
    group.querySelector('canvas[data-pet-raster-active="true"]'),
  ).toBeTruthy();
  expect(figure.getMotionFailure!()).toBe("unsupported-motion-resource");
});
