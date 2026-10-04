import { describe, expect, it } from "vitest";
import { SequencePlayer } from "@features/desktop-pet/sequences/player";
import { PetLocomotion } from "@features/desktop-pet/locomotion/controller";
import {
  sequencePhysicalLinkUnavailable,
  sequenceLinkUnavailable,
} from "@features/desktop-pet/sequences/capabilities";
import type { PetEnvironment } from "@platform/petMotion";
import { sequenceDemoUnavailable } from "@features/desktop-pet/locomotion/motionAvailability";
import type {
  FrameSequences,
  SequenceFrame,
  SequencePoint,
  SequenceSample,
} from "@features/desktop-pet/sequences/types";

const TAU = Math.PI * 2;
const pack = (direction: SequencePoint = [1, 0]): FrameSequences => {
  const frames: SequenceFrame[] = Array.from({ length: 8 }, (_, i) => {
    const supports: NonNullable<SequenceFrame["supports"]> = {};
    const point = (distance: number): SequencePoint => [
      100 - distance * direction[0],
      200 - distance * direction[1],
    ];
    if (i <= 4 || i === 7) supports.legFront = point(i === 7 ? -7.5 : i * 7.5);
    if (i === 0 || i >= 3)
      supports.legBack = point(i === 0 ? 30 : (i - 4) * 7.5);
    return {
      texture: "whole",
      rect: [i * 200, 0, 200, 300],
      durationMs: 125,
      grip: [100, 100],
      foot: [100, 200],
      head: [
        [100, 10],
        [100, 60],
      ],
      supports,
    };
  });
  return {
    version: 1,
    frameSize: [200, 300],
    modelBox: [0, 0, 200, 300],
    headLength: 50,
    clips: {
      idle: { frames: [frames[0]], loop: true },
      walk: { frames, loop: true, distancePerCycle: 60 },
    },
    transitions: [],
  };
};
const world = (
  sample: SequenceSample,
  name: "legFront" | "legBack",
  travel: SequencePoint,
  scale: number,
): SequencePoint => {
  const point = sample.anchors.supports[name]!;
  return [(travel[0] + point[0]) * scale, (travel[1] + point[1]) * scale];
};

describe("whole cel host-confirmed support", () => {
  it("physical demo capability rejects a missing middle support before user playback, while event links remain available", () => {
    const { source } = bridgePack("start");
    source.clips["walk-right"] = source.clips.walk;
    delete source.clips.walk;
    source.transitions[0].to = "walk-right";
    source.clips.return = {
      frames: [
        ...structuredClone(source.clips["walk-right"].frames),
        source.clips.idle.frames[0],
      ],
      loop: false,
    };
    source.transitions.push({
      id: "return",
      from: "walk-right",
      to: "idle",
      clip: "return",
    });
    delete source.clips.start.frames[1].supports;
    expect(sequenceLinkUnavailable(source, "idle", "walk-right")).toBeNull();
    expect(
      sequenceDemoUnavailable({ frameSequences: source }, "walk-right"),
    ).toContain("实际支撑点：start");
    source.clips.start.frames[1].supports = structuredClone(
      source.clips.idle.frames[0].supports,
    );
    delete source.clips.return.frames[1].supports;
    // Endpoint and intermediate cel share the same original rect here; retain
    // the registered endpoint separately so this specifically checks the bridge.
    source.clips.return.frames.splice(
      1,
      0,
      structuredClone(source.clips["walk-right"].frames[1]),
    );
    expect(
      sequenceDemoUnavailable({ frameSequences: source }, "walk-right"),
    ).toContain("实际支撑点：return");
  });
  const bridgePack = (kind: "start" | "stop" | "corner") => {
    const source = pack();
    const endpoint = source.clips.walk.frames[0];
    source.clips.idle.frames = [endpoint];
    const middle = {
      ...structuredClone(endpoint),
      rect: [1600, 0, 200, 300] as [number, number, number, number],
    };
    const target =
      kind === "start" ? "walk" : kind === "stop" ? "idle" : "top-right";
    if (kind === "corner")
      source.clips[target] = {
        frames: [endpoint],
        loop: true,
        distancePerCycle: 60,
      };
    const from = kind === "start" ? "idle" : "walk";
    source.clips[kind] = { frames: [endpoint, middle, endpoint], loop: false };
    source.transitions = [{ id: kind, from, to: target, clip: kind }];
    return { source, from, target };
  };
  it.each(["start", "stop", "corner"] as const)(
    "checks every timed %s bridge cel at a fixed host position",
    (kind) => {
      const { source, from, target } = bridgePack(kind);
      const player = new SequencePlayer(source);
      const initial = player.sample({
        clip: from,
        t: 0,
        phase: 0,
        travel: [55, -20],
        supportRequired: true,
      })!;
      let maximum = 0;
      for (let i = 0; i <= 25; i++) {
        const sample = player.sample({
          clip: target,
          t: 0.01 + i / 60,
          phase: 0,
          travel: [55, -20],
          supportRequired: true,
        })!;
        expect(sample.motionFailure).toBeUndefined();
        for (const name of ["legFront", "legBack"] as const)
          maximum = Math.max(
            maximum,
            Math.hypot(
              ...world(sample, name, [55, -20], 1).map(
                (value, axis) =>
                  value - world(initial, name, [55, -20], 1)[axis],
              ),
            ),
          );
      }
      expect(maximum).toBeLessThan(1e-8);
      expect(player.getMotionTransition()).toBeNull();
    },
  );
  it.each(["start", "stop", "corner"] as const)(
    "rejects a %s bridge whose middle painted support slides five DIP",
    (kind) => {
      const { source, from, target } = bridgePack(kind);
      source.clips[kind].frames[1].supports!.legFront![0] += 5;
      const player = new SequencePlayer(source);
      const initial = player.sample({
        clip: from,
        t: 0,
        phase: 0,
        travel: [0, 0],
        supportRequired: true,
      })!;
      player.sample({
        clip: target,
        t: 0.01,
        phase: 0,
        travel: [0, 0],
        supportRequired: true,
      });
      const failed = player.sample({
        clip: target,
        t: 0.14,
        phase: 0,
        travel: [0, 0],
        supportRequired: true,
      })!;
      expect(failed.motionFailure?.reason).toBe(
        "support-registration-mismatch",
      );
      expect(failed.frame).toEqual(initial.frame);
      expect(failed.translation).toEqual(initial.translation);
      expect(player.getMotionTransition()).toBeNull();
    },
  );
  it("physical timed bridges reject missing supports and source-only event bridges remain compatible", () => {
    const { source, from, target } = bridgePack("stop");
    delete source.clips.stop.frames[1].supports;
    const structural = structuredClone(source);
    structural.clips.walk.frames = structural.clips.walk.frames.slice(0, 1);
    expect(sequencePhysicalLinkUnavailable(structural, from, target)).toContain(
      "实际支撑点",
    );
    expect(sequenceLinkUnavailable(structural, from, target)).toBeNull();
    const physical = new SequencePlayer(source);
    physical.sample({
      clip: from,
      t: 0,
      phase: 0,
      travel: [0, 0],
      supportRequired: true,
    });
    physical.sample({
      clip: target,
      t: 0.01,
      phase: 0,
      travel: [0, 0],
      supportRequired: true,
    });
    expect(
      physical.sample({
        clip: target,
        t: 0.14,
        phase: 0,
        travel: [0, 0],
        supportRequired: true,
      })!.motionFailure?.reason,
    ).toBe("missing-support");
    const offline = new SequencePlayer(source);
    offline.sample({ clip: from, t: 0, phase: 0 });
    offline.sample({ clip: target, t: 0.01, phase: 0 });
    expect(
      offline.sample({ clip: target, t: 0.14, phase: 0 })!.motionFailure,
    ).toBeUndefined();
  });
  it("timed bridges require a shared support for the new limb before releasing the old one", () => {
    const { source, from, target } = bridgePack("stop");
    source.clips.stop.frames[1].supports = { armNear: [100, 200] };
    const structural = structuredClone(source);
    structural.clips.walk.frames = structural.clips.walk.frames.slice(0, 1);
    expect(sequencePhysicalLinkUnavailable(structural, from, target)).toContain(
      "支点交接",
    );
    const player = new SequencePlayer(source);
    player.sample({
      clip: from,
      t: 0,
      phase: 0,
      travel: [0, 0],
      supportRequired: true,
    });
    player.sample({
      clip: target,
      t: 0.01,
      phase: 0,
      travel: [0, 0],
      supportRequired: true,
    });
    expect(
      player.sample({
        clip: target,
        t: 0.14,
        phase: 0,
        travel: [0, 0],
        supportRequired: true,
      })!.motionFailure?.reason,
    ).toBe("support-handoff-missing");
  });
  it("actual controller stop carries the final immutable confirmed travel into the complete exit bridge", () => {
    const environment: PetEnvironment = {
      revision: 1,
      generation: 0,
      bounds: { x: -400, y: 200, width: 300, height: 400 },
      displayId: 1,
      workArea: { x: -800, y: 0, width: 1600, height: 900 },
      visible: true,
    };
    const controller = new PetLocomotion(
      environment,
      { roam: "free", size: 220, edgeClimbing: true, highGliding: true },
      () => {},
      () => 0.9,
    );
    controller.frame.state = "walk";
    controller.receipt(
      { ...environment, bounds: { ...environment.bounds, x: -390 } },
      0.05,
    );
    controller.stop();
    const stopped = controller.frame;
    expect(stopped.travel).toEqual({ x: 10, y: 0 });
    const { source, from, target } = bridgePack("stop");
    const player = new SequencePlayer(source);
    const before = player.sample({
      clip: from,
      t: 0,
      phase: 0,
      travel: [10, 0],
      supportRequired: true,
    })!;
    const bridge = player.sample({
      clip: target,
      t: 0.01,
      phase: stopped.phase,
      travel: [stopped.travel!.x, stopped.travel!.y],
      supportRequired: true,
    })!;
    expect(world(bridge, "legFront", [10, 0], 1)).toEqual(
      world(before, "legFront", [10, 0], 1),
    );
    controller.receipt(
      {
        ...controller.environment,
        bounds: { ...controller.environment.bounds, x: -385 },
      },
      0.05,
    );
    expect(stopped.travel).toEqual({ x: 10, y: 0 });
    controller.updateEnvironment({ ...environment, revision: 2 });
    expect(controller.frame.travel).toEqual({ x: 0, y: 0 });
  });
  it.each([30, 60])(
    "keeps real projected support fixed for six seconds at %i fps in four directions and three scales",
    (fps) => {
      for (const direction of [
        [1, 0],
        [-1, 0],
        [0, -1],
        [0, 1],
      ] as SequencePoint[]) {
        for (const scale of [0.7, 1, 1.6]) {
          const player = new SequencePlayer(pack(direction));
          let active: Partial<Record<"legFront" | "legBack", SequencePoint>> =
            {};
          let drift = 0;
          for (let i = 0; i <= fps * 6; i++) {
            const distance = ((i / fps) * 60) / scale;
            const travel: SequencePoint = [
              direction[0] * distance,
              direction[1] * distance,
            ];
            const sample = player.sample({
              clip: "walk",
              t: i / fps,
              phase: (distance / 60) * TAU,
              travel,
              worldScale: scale,
              direction,
            })!;
            expect(sample.motionFailure).toBeUndefined();
            const next: typeof active = {};
            for (const name of Object.keys(sample.anchors.supports) as (
              "legFront" | "legBack"
            )[]) {
              const point = world(sample, name, travel, scale);
              if (active[name])
                drift = Math.max(
                  drift,
                  Math.hypot(
                    point[0] - active[name]![0],
                    point[1] - active[name]![1],
                  ),
                );
              next[name] = active[name] ?? point;
            }
            active = next;
            expect(sample.scale).toBe(1);
            expect(sample.modelBox).toEqual([0, 0, 200, 300]);
          }
          expect(drift).toBeLessThan(1e-8);
        }
      }
    },
  );
  it("reproduces uncorrected eight-cel support drift during one cel while corrected whole translation stays still", () => {
    const player = new SequencePlayer(pack());
    const initial = player.sample({
      clip: "walk",
      t: 0,
      phase: 0,
      travel: [0, 0],
    })!;
    const moved = player.sample({
      clip: "walk",
      t: 0.1,
      phase: (6 / 60) * TAU,
      travel: [6, 0],
    })!;
    expect(moved.frameIndex).toBe(initial.frameIndex);
    expect(
      6 +
        moved.frame.supports!.legFront![0] -
        initial.frame.supports!.legFront![0],
    ).toBe(6);
    expect(world(moved, "legFront", [6, 0], 1)).toEqual(
      world(initial, "legFront", [0, 0], 1),
    );
    expect(moved.translation).toEqual([-6, 0]);
  });
  it("rejects incorrect painted sole registration before translating or changing the actual cel", () => {
    const source = pack();
    source.clips.walk.frames[1].supports!.legFront![0] += 2;
    const player = new SequencePlayer(source);
    const initial = player.sample({
      clip: "walk",
      t: 0,
      phase: 0,
      travel: [0, 0],
    })!;
    const failed = player.sample({
      clip: "walk",
      t: 0.125,
      phase: TAU / 8,
      travel: [7.5, 0],
    })!;
    expect(failed.motionFailure?.reason).toBe("support-registration-mismatch");
    expect(failed.frame).toEqual(initial.frame);
    expect(world(failed, "legFront", [7.5, 0], 1)).toEqual(
      world(initial, "legFront", [0, 0], 1),
    );
    expect(failed.translation).toEqual([-7.5, 0]);
    expect(player.getMotionTransition()).toBeNull();
  });
  it("rejects a support identity handoff that never establishes the new foot before releasing the old", () => {
    const source = pack();
    source.clips.walk.frames[1].supports = { legBack: [92.5, 200] };
    const player = new SequencePlayer(source);
    delete source.clips.walk.frames[0].supports!.legBack;
    const isolated = new SequencePlayer(source);
    isolated.sample({ clip: "walk", t: 0, phase: 0, travel: [0, 0] });
    expect(
      isolated.sample({
        clip: "walk",
        t: 0.125,
        phase: TAU / 8,
        travel: [7.5, 0],
      })!.motionFailure?.reason,
    ).toBe("support-handoff-missing");
    expect(player.getMotionFailure()).toBeNull();
  });
  it("does not infer movement from phase, accepts signed travel, and rejects phase/distance contradictions", () => {
    const player = new SequencePlayer(pack());
    player.sample({ clip: "walk", t: 0, phase: 0, travel: [0, 0] });
    expect(
      player.sample({ clip: "walk", t: 0.1, phase: TAU / 8, travel: [0, 0] })!
        .motionFailure?.reason,
    ).toBe("invalid-support-motion");
    const left = new SequencePlayer(pack([-1, 0]));
    left.sample({ clip: "walk", t: 0, phase: 0, travel: [0, 0] });
    expect(
      left.sample({
        clip: "walk",
        t: 0.125,
        phase: TAU / 8,
        travel: [-7.5, 0],
      })!.motionFailure,
    ).toBeUndefined();
  });
  it("rejects missing physical supports but preserves phase-only offline cel selection", () => {
    const source = pack();
    for (const frame of source.clips.walk.frames) delete frame.supports;
    const physical = new SequencePlayer(source);
    expect(
      physical.sample({ clip: "walk", t: 0, phase: 0, travel: [0, 0] }),
    ).toBeNull();
    expect(physical.getMotionFailureDetails()?.reason).toBe("missing-support");
    expect(
      new SequencePlayer(source).sample({ clip: "walk", t: 0, phase: Math.PI })!
        .frameIndex,
    ).toBe(4);
  });
  it("cancel retains the exact painted registration and starts a new support lifetime without catch-up", () => {
    const player = new SequencePlayer(pack());
    player.sample({ clip: "walk", t: 0, phase: 0, travel: [0, 0] });
    const before = player.sample({
      clip: "walk",
      t: 0.1,
      phase: (6 / 60) * TAU,
      travel: [6, 0],
    })!;
    player.cancelMotionPlayback();
    const after = player.sample({
      clip: "walk",
      t: 100,
      phase: 0,
      travel: [-200, 100],
    })!;
    expect(after.frame).toEqual(before.frame);
    expect(after.translation).toEqual(before.translation);
    expect(after.motionFailure).toBeUndefined();
    const advanced = player.sample({
      clip: "walk",
      t: 100.01,
      phase: (1 / 60) * TAU,
      travel: [-199, 100],
    })!;
    expect(world(advanced, "legFront", [-199, 100], 1)).toEqual(
      world(after, "legFront", [-200, 100], 1),
    );
  });
  it("worldScale change resets the support lifetime without per-cel fitting", () => {
    const player = new SequencePlayer(pack());
    player.sample({
      clip: "walk",
      t: 0,
      phase: 0,
      travel: [0, 0],
      worldScale: 1,
    });
    const rescaled = player.sample({
      clip: "walk",
      t: 0.1,
      phase: 0,
      travel: [100, 0],
      worldScale: 2,
    })!;
    expect(rescaled.motionFailure).toBeUndefined();
    expect(rescaled.scale).toBe(1);
    expect(rescaled.translation).toEqual([0, 0]);
  });
  it("uses duration-weighted reference distance rather than index divided by frame count", () => {
    const source = pack();
    const durations = [50, 150, 50, 200, 100, 150, 100, 200];
    let cumulative = 0;
    source.clips.walk.frames.forEach((frame, i) => {
      frame.durationMs = durations[i];
      const fraction = cumulative / 1000;
      if (frame.supports!.legFront)
        frame.supports!.legFront = [
          100 - (fraction - (i === 7 ? 1 : 0)) * 60,
          200,
        ];
      if (frame.supports!.legBack)
        frame.supports!.legBack = [
          100 - (fraction - (i === 0 ? -0.5 : 0.5)) * 60,
          200,
        ];
      cumulative += durations[i];
    });
    const player = new SequencePlayer(source);
    player.sample({ clip: "walk", t: 0, phase: 0, travel: [0, 0] });
    const sample = player.sample({
      clip: "walk",
      t: 0.1,
      phase: TAU * 0.1,
      travel: [6, 0],
    })!;
    expect(sample.frameIndex).toBe(1);
    expect(sample.motionFailure).toBeUndefined();
    expect(world(sample, "legFront", [6, 0], 1)).toEqual([100, 200]);
  });
  it.each([NaN, Infinity, -1, 301])(
    "rejects an illegal source support coordinate %s rather than propagating it into drawing",
    (value) => {
      const source = pack();
      source.clips.walk.frames[0].supports!.legFront![1] = value;
      const player = new SequencePlayer(source);
      expect(
        player.sample({ clip: "walk", t: 0, phase: 0, travel: [0, 0] }),
      ).toBeNull();
      expect(player.getMotionFailureDetails()?.reason).toBe("invalid-frame");
    },
  );
  it.each([
    { travel: [NaN, 0] as SequencePoint },
    { travel: [Infinity, 0] as SequencePoint },
  ])("rejects nonfinite actual travel %s", ({ travel }) => {
    const player = new SequencePlayer(pack());
    expect(player.sample({ clip: "walk", t: 0, phase: 0, travel })).toBeNull();
    expect(player.getMotionFailureDetails()?.reason).toBe(
      "invalid-support-motion",
    );
  });
  it("a rejected switch releases the physical lifetime without replacing the painted cel", () => {
    const player = new SequencePlayer(pack());
    const initial = player.sample({
      clip: "walk",
      t: 0,
      phase: 0,
      travel: [0, 0],
    })!;
    const rejected = player.sample({ clip: "held", t: 0.1 })!;
    expect(rejected.frame).toEqual(initial.frame);
    expect(rejected.motionFailure?.reason).toBe("missing-clip");
    const restarted = player.sample({
      clip: "walk",
      t: 0.2,
      phase: 0,
      travel: [-1000, 200],
    })!;
    expect(restarted.motionFailure).toBeUndefined();
    expect(restarted.translation).toEqual(initial.translation);
  });
});
