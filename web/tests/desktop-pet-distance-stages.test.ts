import { describe, expect, it } from "vitest";
import { SequencePlayer } from "@features/desktop-pet/sequences/player";
import { readFrameSequences } from "@features/desktop-pet/sequences/validation";
import { PetLocomotion } from "@features/desktop-pet/locomotion/controller";
import type {
  SequenceInput,
  SequenceSample,
} from "@features/desktop-pet/sequences/types";
import type {
  PetEnvironment,
  PetGeometry,
  PetPosePlayback,
} from "@platform/petMotion";

import { stagedClimbFixture as fixture } from "./fixtures/staged-climb-sequence";

function input(t: number, distance = 0, scale = 1): SequenceInput {
  return {
    clip: "side-right",
    t,
    phase: (distance / 8) * Math.PI * 2,
    travel: [0, -distance],
    worldScale: scale,
    direction: [0, -1],
    supportRequired: true,
  };
}

describe("optional cumulative distance contract", () => {
  it("rejects an inherited boundary instead of materializing it as a trusted stage", () => {
    const raw = fixture();
    const track = raw.clips["side-right"].distanceAtFrame!;
    delete track[2];
    Object.setPrototypeOf(track, { 2: 4 });
    expect(() => readFrameSequences(raw)).toThrow("阶段累计距离");
  });
  it("clones the track, keeps inline/registry and old timing compatible", () => {
    const raw = fixture();
    const parsed = readFrameSequences(raw)!;
    parsed.clips["side-right"].distanceAtFrame![2] = 3;
    expect(raw.clips["side-right"].distanceAtFrame![2]).toBe(4);
    delete raw.clips["side-right"].distanceAtFrame;
    expect(
      readFrameSequences(raw)!.clips["side-right"].distanceAtFrame,
    ).toBeUndefined();
  });
  it.each(
    [
      null,
      undefined,
      "0,4,8",
      [],
      [0, 8],
      [1, 1, 4, 4, 4, 8, 8],
      [0, 0, 4, 3, 4, 8, 8],
      [0, 0, 4, 4, 4, 8, 7],
      [0, 0, 4, 4, 4, 8, 9],
      [0, false, 4, 4, 4, 8, 8],
      [0, NaN, 4, 4, 4, 8, 8],
      [0, Infinity, 4, 4, 4, 8, 8],
    ].map((track) => ({ track })),
  )("rejects malformed boundaries $track", ({ track }) => {
    const raw = fixture();
    (
      raw.clips["side-right"] as unknown as Record<string, unknown>
    ).distanceAtFrame = track;
    expect(() => readFrameSequences(raw)).toThrow("阶段累计距离");
  });
  it.each(["no-distance", "timed-clip", "sparse"])(
    "rejects incompatible %s track",
    (mode) => {
      const raw = fixture(),
        clip = raw.clips["side-right"];
      if (mode === "no-distance") delete clip.distancePerCycle;
      if (mode === "timed-clip") clip.loop = false;
      if (mode === "sparse") delete clip.distanceAtFrame![2];
      expect(() => readFrameSequences(raw)).toThrow();
    },
  );
});

describe("production player stationary recovery and confirmed push", () => {
  it("zero travel advances timed recovery, a long clock never skips it or pushes", () => {
    const p = new SequencePlayer(fixture());
    expect(p.sample(input(0))!.frameIndex).toBe(0);
    expect(p.getMotionTransition()!.progress).toBe(0);
    expect(p.sample(input(40))!.frameIndex).toBe(1);
    expect(p.getMotionTransition()!.motionBudget!.remainingDIP).toBe(4);
    expect(p.sample(input(100))!.frameIndex).toBe(1);
    expect(p.sample(input(100.01, 4))!.frameIndex).toBe(2);
    expect(p.getMotionTransition()!.progress).toBe(0);
    expect(p.sample(input(100.111, 4))!.frameIndex).toBe(3);
    expect(p.sample(input(900, 4))!.frameIndex).toBe(4);
    expect(p.sample(input(1200, 4))!.frameIndex).toBe(4);
    expect(p.getMotionFailure()).toBeNull();
  });
  it("only a drawn cel commits its clock, budget and selection", () => {
    const p = new SequencePlayer(fixture());
    p.present(input(0), { kind: "sample" }, () => true);
    const before = p.getMotionTransition();
    expect(p.present(input(0.2), { kind: "sample" }, () => false)).toBeNull();
    expect(p.getMotionTransition()).toEqual(before);
    const after = p.present(input(0.2), { kind: "sample" }, () => true)!;
    expect(after.frameIndex).toBe(1);
    expect(p.getMotionTransition()!.progress).toBe(1);
    const copy = p.getMotionTransition()!;
    copy.motionBudget!.confirmedTravel.y = 50;
    expect(
      p.getMotionTransition()!.motionBudget!.confirmedTravel.y,
    ).toBeCloseTo(0);
  });
  it("cancel preserves the current cel and rebases clocks/epoch without old catchup", () => {
    const p = new SequencePlayer(fixture());
    p.sample(input(0));
    p.sample(input(0.1));
    p.sample(input(0.11, 4));
    const old = p.getMotionTransition()!;
    p.cancelMotionPlayback();
    const cel = p.sample({ ...input(400, 4), phase: 30 * Math.PI })!;
    expect(cel.frameIndex).toBe(2);
    expect(p.getMotionTransition()!.progress).toBe(0);
    expect(p.getMotionTransition()!.id).not.toBe(old.id);
    expect(p.getMotionFailure()).toBeNull();
  });
  it.each(["selection", "preflight"] as const)(
    "%s rejection freezes the staged recovery clock before returning to its original request",
    (kind) => {
      const p = new SequencePlayer(fixture());
      const actual = p.sample(input(0))!;
      if (kind === "selection") p.sample({ clip: "missing", t: 100 });
      else
        p.rejectMotionPlayback(
          { ...input(100), clip: "missing" },
          "missing-clip",
        );
      const resumed = p.sample(input(200))!;
      expect(resumed.motionFailure).toBeUndefined();
      expect(resumed.frame).toEqual(actual.frame);
      expect(resumed.transition?.progress).toBe(0);
      expect(p.sample(input(200.11))!.frameIndex).toBe(1);
    },
  );
  it.each(["selection", "preflight"] as const)(
    "%s rejection rebases a partly advanced staged phase before returning",
    (kind) => {
      const p = new SequencePlayer(fixture());
      p.sample(input(0));
      p.sample(input(0.11));
      const actual = p.sample(input(0.12, 2))!;
      const rejected = { ...input(100, 2), clip: "missing" };
      if (kind === "selection") p.sample(rejected);
      else p.rejectMotionPlayback(rejected, "missing-clip");
      const resumed = p.sample({ ...input(200, 2), phase: 0 })!;
      expect(resumed.motionFailure).toBeUndefined();
      expect(resumed.frame).toEqual(actual.frame);
      expect(resumed.translation).toEqual(actual.translation);
      expect(resumed.transition?.motionBudget?.remainingDIP).toBeCloseTo(2);
      expect(
        p.sample({ ...input(200.01, 4), phase: Math.PI / 2 })!.frameIndex,
      ).toBe(2);
      expect(p.getMotionFailure()).toBeNull();
    },
  );
  it("never silently crosses a motion endpoint or fits a badly drawn shared contact", () => {
    const p = new SequencePlayer(fixture());
    p.sample(input(0));
    p.sample(input(0.1));
    expect(p.sample(input(0.2, 6))!.frameIndex).toBe(1);
    expect(p.getMotionFailure()).toBe("sequence:invalid-support-motion");
    const bad = fixture();
    bad.clips["side-right"].frames[2].supports!.armFar![1] += 2;
    const broken = new SequencePlayer(bad);
    broken.sample(input(0));
    broken.sample(input(0.1));
    const kept = broken.sample(input(0.2, 4))!;
    expect(kept.frameIndex).toBe(1);
    expect(broken.getMotionFailure()).toBe(
      "sequence:support-registration-mismatch",
    );
    expect(kept.anchors.supports.armFar![1] - 4).toBe(40);
  });
  it.each([30, 60])(
    "%ifps: four-point handoff and loop retain every active world point",
    (fps) => {
      const p = new SequencePlayer(fixture()),
        scale = 1.75;
      let distance = 0;
      let observed: Record<string, number[]> = {};
      let maxDrift = 0;
      let previous: SequenceSample | null = null;
      const visited = new Set<number>();
      for (let i = 0; i < fps * 4; i++) {
        const feedback = p.getMotionTransition();
        if (feedback?.progress === 1)
          distance += Math.min(
            40 / fps / scale,
            feedback.motionBudget!.remainingDIP / scale,
          );
        const sample = p.present(
          input(i / fps, distance, scale),
          { kind: "sample" },
          () => true,
        )!;
        expect(sample.motionFailure).toBeUndefined();
        visited.add(sample.frameIndex);
        const next: Record<string, number[]> = {};
        for (const [name, point] of Object.entries(sample.anchors.supports)) {
          const world = [point![0] * scale, (point![1] - distance) * scale];
          const base = observed[name] ?? world;
          maxDrift = Math.max(
            maxDrift,
            Math.hypot(world[0] - base[0], world[1] - base[1]),
          );
          next[name] = base;
        }
        if (previous)
          expect(
            Object.keys(next).some((n) => Object.hasOwn(observed, n)),
          ).toBe(true);
        observed = next;
        previous = sample;
      }
      expect(visited.size).toBe(6);
      expect(distance).toBeGreaterThan(16);
      expect(maxDrift).toBeLessThan(1e-9);
    },
  );
});

const env: PetEnvironment = {
  generation: 1,
  revision: 1,
  displayId: 1,
  visible: true,
  bounds: { x: -400, y: 400, width: 300, height: 300 },
  workArea: { x: -2000, y: -1000, width: 6000, height: 3000 },
};
const shape: PetGeometry = {
  visible: { x: 0, y: 0, width: 100, height: 100 },
  feet: { x: 50, y: 100 },
  strideLength: 8,
};
function controller() {
  const p = new PetLocomotion(
    structuredClone(env),
    { roam: "free", size: 220, edgeClimbing: false, highGliding: false },
    () => {},
    () => 0.75,
  );
  for (let i = 0; i < 140; i++) p.step(0.05, shape);
  expect(p.frame.state).toBe("walk");
  return p;
}
const feedback = (remainingDIP: number): PetPosePlayback => ({
  id: "push",
  progress: 1,
  motionBudget: {
    epoch: "push1",
    remainingDIP,
    confirmedTravel: { x: 0, y: 0 },
  },
});
describe("controller total outstanding distance budget", () => {
  it("pending ticks coalesce one target and late receipts cannot replenish an old allowance", () => {
    const p = controller();
    const f = feedback(2);
    for (let i = 0; i < 10; i++) p.step(0.03, shape, f);
    expect(p.x - env.bounds.x).toBeCloseTo(2);
    const receipt = {
      ...env,
      bounds: { ...env.bounds, x: env.bounds.x + 1.2 },
    };
    p.receipt(receipt, 0.03, { x: p.x, y: p.y });
    for (let i = 0; i < 10; i++) p.step(0.03, shape, f);
    expect(p.x - env.bounds.x).toBeCloseTo(2);
    p.receipt({ ...env, bounds: { ...env.bounds, x: env.bounds.x + 2 } }, 0.03);
    expect(p.step(0.03, shape, f)).toBe(false);
    expect(p.frame.phase).toBeCloseTo((2 / 8) * Math.PI * 2);
  });
  it("timed holds freeze activity, but deliberate manual movement bypasses the old budget", () => {
    const p = controller();
    const hold = { ...feedback(0), progress: 0.5 };
    for (let i = 0; i < 400; i++) expect(p.step(0.05, shape, hold)).toBe(false);
    expect(p.frame.state).toBe("walk");
    p.press(0, 0);
    p.pointer(30, 0);
    expect(p.step(0.05, shape, hold)).toBe(true);
    expect(p.manual).toBe(true);
    expect(p.x - env.bounds.x).toBe(30);
    p.release(true);
    expect(p.frame.state).toBe("idle");
  });
  it("no optional feedback preserves legacy continuous walk", () => {
    const p = controller();
    for (let i = 0; i < 10; i++) p.step(0.03, shape);
    expect(p.x - env.bounds.x).toBeGreaterThan(2);
  });
});

it.each(["free", "calm"] as const)(
  "%s attached rest is not locked by a timed loop recovery budget",
  (roam) => {
    const edgeEnv = { ...env, bounds: { ...env.bounds, x: 3896 } };
    const events: string[] = [];
    const p = new PetLocomotion(
      edgeEnv,
      { roam, size: 220, edgeClimbing: true, highGliding: false },
      (e) => events.push(e),
      () => 0.75,
    );
    const geometry = { ...shape, supportedEdges: ["right" as const] };
    const tick = (f?: PetPosePlayback) => {
      const moving = p.step(0.05, geometry, f);
      if (moving)
        p.receipt(
          {
            ...p.environment,
            bounds: { ...p.environment.bounds, x: p.x, y: p.y },
          },
          0.05,
        );
    };
    for (let i = 0; i < 500 && p.frame.attachment !== "resting"; i++) tick();
    expect(p.frame.attachment).toBe("resting");
    expect(events).toEqual(["roam"]);
    const hold = { ...feedback(0), progress: 0.5 };
    hold.motionBudget!.confirmedTravel = { ...p.frame.travel! };
    const before = { x: p.x, y: p.y };
    const ticks = (roam === "free" ? 7 : 17) * 20;
    for (let i = 0; i < ticks - 1; i++) tick(hold);
    expect(events).toEqual(["roam"]);
    expect({ x: p.x, y: p.y }).toEqual(before);
    tick(hold);
    expect(events).toEqual(["roam", "roam"]);
    expect({ x: p.x, y: p.y }).toEqual(before);
  },
);
