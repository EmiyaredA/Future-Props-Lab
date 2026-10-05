import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";
import { stagedClimbFixture } from "./fixtures/staged-climb-sequence";
let resolveDecode: (() => void) | null = null;
let waitForCel1 = false;
const paints = vi.fn();
class TestImage {
  src = "";
  naturalWidth = 100;
  naturalHeight = 100;
  async decode() {
    if (waitForCel1 && this.src.endsWith("cel1.png"))
      await new Promise<void>((resolve) => {
        resolveDecode = resolve;
      });
  }
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
beforeEach(() => {
  resolveDecode = null;
  waitForCel1 = false;
  paints.mockReset();
  vi.stubGlobal("Image", TestImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      drawImage: paints,
      clearRect: vi.fn(),
    })) as unknown as HTMLCanvasElement["getContext"],
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const seq = stagedClimbFixture();
  seq.modelBox = [12, -8, 50, 50];
  seq.headLength = 10;
  const c = seq.clips["side-right"];
  c.distancePerCycle = 4;
  c.distanceAtFrame = [0, 0, 2, 2, 2, 4, 4];
  seq.clips.start = {
    loop: false,
    frames: [seq.clips.idle.frames[0], c.frames[0]],
  };
  seq.transitions = [
    { id: "entry", from: "idle", to: "side-right", clip: "start" },
  ];
  const base: LoadedWhaleFigure = {
    scheme: "classic",
    fixedScale: true,
    motionFacing: () => 1,
    preload: async () => {},
    setScheme: async () => {},
    reset: vi.fn(),
    draw: vi.fn(),
  };
  const figure = createSequenceFigure({
    base,
    sequences: seq,
    scheme: "classic",
    defaultScheme: "classic",
    asset: (p) => `/authorized/${p}`,
  });
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  Object.defineProperty(group, "getScreenCTM", {
    value: () => ({ a: 1.5, b: 0, c: 0, d: 1.5, e: -400, f: 200 }),
  });
  function draw(t: number, travel = 0, climb = true) {
    const frame: WhaleFrame = {
      t,
      mode: climb ? "climb" : "idle",
      swing: 0,
      sit: 0,
      look: [0, 0],
      legs: [],
      worldScale: 9,
      ...(climb
        ? {
            locomotion: {
              state: "climb",
              facing: 1,
              edge: "right",
              phase: (travel / 6) * Math.PI * 2,
              velocity: { x: 0, y: -40 },
              swing: 0,
              travel: { x: 0, y: -travel },
            },
          }
        : {}),
    };
    figure.draw(group, { eyes: [], gap: [] }, frame);
  }
  const actual = () => {
    const object = group.querySelector("foreignObject")!;
    return {
      y: Number(object.getAttribute("y")),
      width: Number(object.getAttribute("width")),
      height: Number(object.getAttribute("height")),
      texture: (paints.mock.calls.at(-1)![0] as TestImage).src,
    };
  };
  return { figure, draw, actual };
}
async function begin(h: ReturnType<typeof setup>) {
  await h.figure.preload();
  h.draw(0, 0, false);
  h.draw(0.01);
  await settle();
  for (const t of [0.02, 0.12, 0.22, 0.32]) h.draw(t);
  expect(h.figure.getMotionFailure?.()).toBeNull();
}
test("actual whole Canvas publishes fixed-scale budgets only after entry and draws each support handoff", async () => {
  const h = setup();
  await begin(h);
  expect(h.figure.getMotionTransition?.()?.motionBudget?.remainingDIP).toBe(0);
  h.draw(0.42);
  h.draw(0.52);
  const push = h.figure.getMotionTransition!()!;
  expect(push.progress).toBe(1);
  expect(push.motionBudget?.remainingDIP).toBe(3);
  expect(h.actual().texture).toContain("cel1.png");
  const world = (travel: number, point: number) =>
    200 - travel + (h.actual().y + point * 0.5) * 1.5;
  const foot = world(0, 80);
  for (const travel of [0.9, 1.8, 2.7]) {
    h.draw(0.52 + travel / 100, travel);
    expect(world(travel, 80)).toBeCloseTo(foot, 10);
    expect(h.actual().width).toBe(50);
    expect(h.actual().height).toBe(50);
  }
  h.draw(0.6, 3);
  expect(h.actual().texture).toContain("cel2.png");
  expect(world(3, 84)).toBeCloseTo(foot, 10);
  expect(h.figure.getMotionTransition?.()?.progress).toBe(0);
  expect(h.figure.getMotionTransition?.()?.motionBudget?.remainingDIP).toBe(0);
  h.draw(0.71, 3);
  h.draw(0.72, 3);
  expect(h.actual().texture).toContain("cel3.png");
  h.draw(0.82, 3);
  h.draw(0.83, 3);
  expect(h.actual().texture).toContain("cel4.png");
  const next = world(3, 70);
  h.draw(0.9, 6);
  expect(h.actual().texture).toContain("cel5.png");
  expect(world(6, 74)).toBeCloseTo(next, 10);
  expect(
    paints.mock.calls.every(
      (call) => call.slice(-4).join(",") === "0,0,100,100",
    ),
  ).toBe(true);
  const copy = h.figure.getMotionTransition!()!;
  copy.motionBudget!.confirmedTravel.y = 999;
  expect(
    h.figure.getMotionTransition?.()?.motionBudget?.confirmedTravel.y,
  ).toBe(-6);
  h.figure.dispose?.();
});
test("pending atlas holds idle and cannot commit a push stage before decode", async () => {
  const h = setup();
  await h.figure.preload();
  h.draw(0, 0, false);
  waitForCel1 = true;
  h.draw(0.01);
  await settle();
  expect(resolveDecode).not.toBeNull();
  for (const t of [1, 2, 3, 40]) h.draw(t);
  expect(h.actual().texture).toContain("cel0.png");
  expect(h.figure.getMotionTransition?.()?.progress).toBe(0);
  expect(h.figure.getMotionTransition?.()?.motionBudget).toBeUndefined();
  resolveDecode!();
  await settle();
  h.draw(40.01);
  expect(h.figure.getMotionTransition?.()?.progress).toBe(0);
  expect(h.figure.getMotionTransition?.()?.motionBudget).toBeUndefined();
  for (const t of [40.11, 40.21, 40.31, 40.41]) h.draw(t);
  expect(h.figure.getMotionTransition?.()?.motionBudget?.remainingDIP).toBe(3);
  expect(h.figure.getMotionFailure?.()).toBeNull();
  h.figure.dispose?.();
});
test("a failed Canvas install cannot advance recovery or authorize the next push", async () => {
  const h = setup();
  await begin(h);
  const before = h.figure.getMotionTransition?.();
  paints.mockImplementationOnce(() => {
    throw new Error("canvas-write");
  });
  expect(() => h.draw(0.43)).toThrow("canvas-write");
  expect(h.figure.getMotionTransition?.()).toEqual(before);
  h.draw(0.43);
  expect(h.figure.getMotionTransition?.()?.motionBudget?.remainingDIP).toBe(0);
  h.draw(0.54);
  h.draw(0.55);
  expect(h.figure.getMotionTransition?.()?.motionBudget?.remainingDIP).toBe(3);
  h.figure.dispose?.();
});
