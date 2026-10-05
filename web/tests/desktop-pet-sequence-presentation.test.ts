import { afterEach, expect, test, vi } from "vitest";
import { createPet } from "@features/desktop-pet/whale-vendor/pet-core.js";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import { SequencePlayer } from "@features/desktop-pet/sequences/player";
import type {
  FrameSequences,
  SequenceFrame,
  SequenceInput,
} from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";

// Actual public core/Player/Figure; controlled browser paint faults, no native/art claim.
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
const pack = (): FrameSequences => ({
  version: 1,
  frameSize: [100, 200],
  modelBox: [0, 0, 100, 200],
  headLength: 40,
  clips: {
    idle: { loop: true, frames: [cel(), cel({ rect: [100, 0, 100, 200] })] },
  },
  transitions: [],
});
const face = { eyes: [], gap: [] };
const frame = (t: number, extra: Partial<WhaleFrame> = {}): WhaleFrame => ({
  t,
  mode: "idle",
  swing: 0,
  sit: 0,
  look: [0, 0],
  legs: [],
  ...extra,
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(source = pack()) {
  class ImageStub {
    src = "";
    naturalWidth = 300;
    naturalHeight = 200;
    async decode() {}
  }
  vi.stubGlobal("Image", ImageStub);
  const paint = vi.fn(),
    clear = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      drawImage: paint,
      clearRect: clear,
    })) as unknown as HTMLCanvasElement["getContext"],
  );
  const base: LoadedWhaleFigure = {
    fixedScale: true,
    scheme: "classic",
    motionFacing: () => 1,
    draw() {},
    setScheme() {},
    preload: async () => undefined,
    reset() {},
    releaseRenderSurface: vi.fn(),
  };
  const figure = createSequenceFigure({
    base,
    sequences: source,
    scheme: "classic",
    defaultScheme: "classic",
    asset: (p) => p,
  });
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
      sfx: new Proxy({}, { get: () => () => {} }),
      bounds: () => ({ W: 400, H: 600, floorY: 560, S: 0.7933 }),
    },
  );
  const draw = (t: number, extra: Partial<WhaleFrame> = {}) =>
    figure.draw(group, face, frame(t, extra));
  return { base, figure, group, pet, paint, clear, draw };
}
const pairs = [
  { fault: 0.05, next: 0.016 },
  { fault: 0.016, next: 0.001 },
  { fault: 0.016, next: 0.016 },
  { fault: 0.1, next: 0.1 },
];
test.each(pairs)(
  "public renderer time gaps recovers Canvas fault $fault -> $next without cancel/retry",
  async ({ fault, next }) => {
    const h = setup();
    await h.figure.preload();
    h.pet.render();
    const error = new Error("original-Canvas-error");
    let thrown = false;
    h.paint.mockImplementation((_image: unknown, x: number) => {
      if (x === 100 && !thrown) {
        thrown = true;
        throw error;
      }
    });
    let caught: unknown;
    for (let i = 0; i < 40 && !thrown; i++) {
      h.pet.step(fault);
      try {
        h.pet.render();
      } catch (e) {
        caught = e;
      }
    }
    expect(caught).toBe(error);
    const count = h.paint.mock.calls.length;
    h.pet.step(next);
    h.pet.render();
    expect(h.paint).toHaveBeenCalledTimes(count + 1);
    expect(h.figure.getMotionFailure?.()).toBeNull();
    for (let i = 0; i < 20; i++) {
      h.pet.step(0.016);
      h.pet.render();
      expect(h.figure.getMotionFailure?.()).toBeNull();
    }
    h.figure.dispose?.();
  },
);
test.each(pairs)(
  "public same-pixel DOM fault $fault -> $next invalidates paint and recovers",
  async ({ fault, next }) => {
    const h = setup();
    await h.figure.preload();
    h.pet.render();
    const error = new Error("original-DOM-error");
    const spy = vi.spyOn(
      h.group.querySelector("foreignObject")!,
      "setAttribute",
    );
    spy.mockImplementationOnce(() => {
      throw error;
    });
    h.pet.step(fault);
    expect(() => h.pet.render()).toThrow(error);
    spy.mockRestore();
    const count = h.paint.mock.calls.length;
    h.pet.step(next);
    h.pet.render();
    expect(h.paint).toHaveBeenCalledTimes(count + 1);
    expect(h.figure.getMotionFailure?.()).toBeNull();
    h.pet.step(0.016);
    h.pet.render();
    expect(h.figure.getMotionFailure?.()).toBeNull();
    h.figure.dispose?.();
  },
);
test("first whole paint exception never retires base and next short tick installs source", async () => {
  const h = setup();
  await h.figure.preload();
  const error = new Error("first-clear");
  h.clear.mockImplementationOnce(() => {
    throw error;
  });
  expect(() => h.pet.render()).toThrow(error);
  expect(h.base.releaseRenderSurface).not.toHaveBeenCalled();
  h.pet.step(0.016);
  h.pet.render();
  expect(h.paint).toHaveBeenCalledTimes(1);
  expect(h.group.getAttribute("data-pet-sequence")).toBe("true");
  expect(h.figure.getMotionFailure?.()).toBeNull();
  h.figure.dispose?.();
});
test("retirement throws after successful installation without rolling back the committed clock/cel", async () => {
  const h = setup();
  await h.figure.preload();
  h.pet.render();
  h.pet.step(0.06);
  h.pet.render();
  const error = new Error("retire-after-commit");
  vi.mocked(h.base.releaseRenderSurface!).mockImplementationOnce(() => {
    throw error;
  });
  h.pet.step(0.05);
  expect(() => h.pet.render()).toThrow(error);
  expect(h.paint.mock.calls.at(-1)!.slice(1, 5)).toEqual([100, 0, 100, 200]);
  const count = h.paint.mock.calls.length;
  h.pet.step(0.016);
  h.pet.render();
  expect(h.paint).toHaveBeenCalledTimes(count);
  expect(h.figure.getMotionFailure?.()).toBeNull();
  h.figure.dispose?.();
});
function physicalPack() {
  const p = pack();
  p.clips.idle.frames = [cel({ supports: { legFront: [80, 190] } })];
  p.clips.walk = {
    loop: true,
    distancePerCycle: 60,
    frames: [
      p.clips.idle.frames[0],
      cel({ rect: [100, 0, 100, 200], supports: { legFront: [50, 190] } }),
    ],
  };
  p.clips.start = {
    loop: false,
    frames: [p.clips.idle.frames[0], p.clips.walk.frames[0]],
  };
  p.transitions = [{ id: "start", from: "idle", to: "walk", clip: "start" }];
  return p;
}
const physical = (t: number, travel: number): SequenceInput => ({
  clip: "walk",
  t,
  phase: (travel / 60) * Math.PI * 2,
  travel: [travel, 0],
  worldScale: 0.7933,
  direction: [1, 0],
  supportRequired: true,
});
test("presentation rollback restores deep support/last/playback then shorter valid sample matches independent player", () => {
  const p = physicalPack(),
    actual = new SequencePlayer(p),
    reference = new SequencePlayer(p);
  for (const player of [actual, reference]) {
    player.sample({ clip: "idle", t: 0 });
    for (const t of [0.01, 0.12, 0.23]) player.sample(physical(t, 0));
  }
  const error = new Error("support-install");
  expect(() =>
    actual.present(physical(0.28, 30), { kind: "sample" }, () => {
      throw error;
    }),
  ).toThrow(error);
  const input = physical(0.246, 1);
  const installed = actual.present(input, { kind: "sample" }, (sample) =>
    Boolean(sample),
  );
  expect(installed).toEqual(reference.sample(input));
  expect(installed!.anchors.supports.legFront![0] + 1).toBe(80);
  expect(actual.getMotionFailure()).toBeNull();
});
test("transition progress, grip and source cel rollback together after middle-pose installation throws", async () => {
  const p = pack(),
    idle = p.clips.idle.frames[0],
    middle = cel({ rect: [100, 0, 100, 200], grip: [45, 75] }),
    held = cel({ rect: [200, 0, 100, 200], grip: [40, 80] });
  p.clips.idle.frames = [idle];
  p.clips.held = { loop: true, frames: [held] };
  p.clips.pickup = { loop: false, frames: [idle, middle, held] };
  p.transitions = [{ id: "pickup", from: "idle", to: "held", clip: "pickup" }];
  const h = setup(p);
  await h.figure.preload();
  h.draw(0);
  h.draw(0.01, { mode: "held", heldPickupPoint: [50, 70] });
  const previous = h.figure.getMotionTransition?.();
  const error = new Error("middle-pose");
  h.paint.mockImplementationOnce(() => {
    throw error;
  });
  expect(() =>
    h.draw(0.11, { mode: "held", heldPickupPoint: [50, 70] }),
  ).toThrow(error);
  expect(h.figure.getMotionTransition?.()).toEqual(previous);
  h.draw(0.126, { mode: "held", heldPickupPoint: [50, 70] });
  expect(h.paint.mock.calls.at(-1)![1]).toBe(0);
  expect(h.figure.pickupPoint?.()).toEqual([50, 70]);
  expect(h.figure.getMotionTransition?.()?.progress).toBeCloseTo(0.016 / 0.3);
  expect(h.figure.getMotionFailure?.()).toBeNull();
  h.figure.dispose?.();
});
test("successful business reject preserves sticky failure; normal hold does not rollback confirmed support", () => {
  const p = physicalPack(),
    player = new SequencePlayer(p);
  player.sample({ clip: "idle", t: 0 });
  for (const t of [0.01, 0.12, 0.23]) player.sample(physical(t, 0));
  const held = player.present(physical(0.24, 3), { kind: "hold" }, (s) =>
    Boolean(s),
  );
  expect(held!.anchors.supports.legFront![0] + 3).toBe(80);
  const rejected = player.present(
    physical(0.25, 4),
    { kind: "reject", reason: "missing-support" },
    (s) => Boolean(s),
  );
  expect(rejected!.motionFailure?.reason).toBe("missing-support");
  expect(player.getMotionFailure()).toBe("sequence:missing-support");
  const error = new Error("rejected-DOM");
  expect(() =>
    player.present(physical(0.3, 9), { kind: "sample" }, () => {
      throw error;
    }),
  ).toThrow(error);
  expect(player.getMotionFailure()).toBe("sequence:missing-support");
  const later = player.present(physical(0.266, 5), { kind: "sample" }, (s) =>
    Boolean(s),
  );
  expect(later!.motionFailure?.reason).toBe("missing-support");
  expect(later!.anchors.supports.legFront![0] + 5).toBe(80);
});
test("actual world-support violations remain business failures after a successful presentation callback", () => {
  const p = physicalPack(),
    player = new SequencePlayer(p);
  p.clips.walk.frames[1].supports!.legFront = [60, 190];
  const broken = new SequencePlayer(p);
  for (const s of [player, broken]) {
    s.sample({ clip: "idle", t: 0 });
    for (const t of [0.01, 0.12, 0.23]) s.sample(physical(t, 0));
  }
  const sample = broken.present(physical(0.24, 30), { kind: "sample" }, (s) =>
    Boolean(s),
  );
  expect(sample!.motionFailure?.reason).toBe("support-registration-mismatch");
  expect(broken.getMotionFailure()).toBe(
    "sequence:support-registration-mismatch",
  );
  expect(
    broken.present(physical(0.25, 31), { kind: "sample" }, (s) => Boolean(s))!
      .motionFailure?.reason,
  ).toBe("support-registration-mismatch");
});
test("synchronous presentation rejects reentrancy before a nested state mutation", () => {
  const player = new SequencePlayer(pack());
  const input = { clip: "idle", t: 0 };
  expect(() =>
    player.present(input, { kind: "sample" }, () =>
      Boolean(player.present(input, { kind: "sample" }, (s) => Boolean(s))),
    ),
  ).toThrow("不能重入");
  expect(player.sample(input)!.frameIndex).toBe(0);
});
test("runtime rejects async installation before invoking it and rejects a promise return without losing prior state", () => {
  const player = new SequencePlayer(pack());
  player.sample({ clip: "idle", t: 0 });
  let entered = false;
  const asyncInstall = (async () => {
    entered = true;
    return true;
  }) as unknown as Parameters<SequencePlayer["present"]>[2];
  expect(() =>
    player.present({ clip: "idle", t: 0.05 }, { kind: "sample" }, asyncInstall),
  ).toThrow("同步安装结果");
  expect(entered).toBe(false);
  const promiseInstall = (() => Promise.resolve(true)) as unknown as Parameters<
    SequencePlayer["present"]
  >[2];
  expect(() =>
    player.present(
      { clip: "idle", t: 0.05 },
      { kind: "sample" },
      promiseInstall,
    ),
  ).toThrow("同步安装结果");
  expect(
    player.present({ clip: "idle", t: 0.016 }, { kind: "sample" }, (s) =>
      Boolean(s),
    )!.frameIndex,
  ).toBe(0);
  expect(player.getMotionFailure()).toBeNull();
});
test("no installation commits normal reject feedback without permitting replacement of the selected cel", () => {
  const player = new SequencePlayer(pack());
  player.sample({ clip: "idle", t: 0 });
  expect(
    player.present(
      { clip: "missing", t: 0.05 },
      { kind: "sample" },
      () => false,
    ),
  ).toBeNull();
  expect(player.getMotionFailure()).toBe("sequence:missing-clip");
  expect(
    player.sample({ clip: "missing", t: 0.066 })!.motionFailure?.reason,
  ).toBe("missing-clip");
});
test.each(["paint", "DOM"] as const)(
  "actual Figure %s exception retains two-clock ownership and confirmed world support",
  async (kind) => {
    const p = physicalPack();
    p.clips["walk-right"] = p.clips.walk;
    delete p.clips.walk;
    p.transitions[0].to = "walk-right";
    const h = setup(p);
    await h.figure.preload();
    h.draw(0);
    const input = (x: number): Partial<WhaleFrame> => ({
      mode: "walk",
      worldScale: 1.2735,
      locomotion: {
        state: "walk",
        facing: 1,
        edge: null,
        phase: (x / 60) * Math.PI * 2,
        velocity: { x: 60, y: 0 },
        swing: 0,
        travel: { x: x * 1.2735, y: 0 },
      },
    });
    for (const t of [0.01, 0.12, 0.23]) h.draw(t, input(0));
    const error = new Error(`physical-${kind}`),
      object = h.group.querySelector("foreignObject")!;
    const spy = kind === "DOM" ? vi.spyOn(object, "setAttribute") : null;
    if (spy)
      spy.mockImplementationOnce(() => {
        throw error;
      });
    else
      h.paint.mockImplementationOnce(() => {
        throw error;
      });
    expect(() => h.draw(0.28, input(30))).toThrow(error);
    spy?.mockRestore();
    const count = h.paint.mock.calls.length;
    h.draw(0.296, input(31));
    expect(h.paint).toHaveBeenCalledTimes(count + 1);
    expect(h.paint.mock.calls.at(-1)![1]).toBe(100);
    expect((Number(object.getAttribute("x")) + 50 + 31) * 1.2735).toBeCloseTo(
      80 * 1.2735,
      10,
    );
    expect(h.figure.getMotionFailure?.()).toBeNull();
    h.figure.dispose?.();
  },
);
