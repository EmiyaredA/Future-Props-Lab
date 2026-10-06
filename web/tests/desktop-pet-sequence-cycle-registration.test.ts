import { describe, expect, it } from "vitest";
import { SequencePlayer } from "@features/desktop-pet/sequences/player";
import type {
  FrameSequences,
  SequenceInput,
  SequencePoint,
  SequenceSample,
} from "@features/desktop-pet/sequences/types";

const g = (0.3139773729535447 * 1280) / 1254;
const D = 30 * g;
const TAU = Math.PI * 2;

// A complete-cel handoff with sub-DIP painted-point discrepancies. No renderer
// or inferred pressure is involved: these are public player resource inputs.
function resource(perfect = false): FrameSequences {
  const nearX = perfect ? 976 : 978;
  const farX = perfect ? 973 : 976;
  const maps = [
    { armFar: [973, 239], armNear: [976, 504] },
    { armNear: [nearX, 504] },
    { armNear: [nearX, 534] },
    { armFar: [farX, 239], armNear: [nearX, perfect ? 534 : 533] },
    { armFar: [perfect ? 973 : 977, 239] },
    { armFar: [973, 239], armNear: [976, 504] },
  ];
  return {
    version: 1,
    frameSize: [1254, 1254],
    modelBox: [0, 0, 1254 * g, 1254 * g],
    headLength: 100,
    clips: {
      stroke: {
        loop: true,
        distancePerCycle: D,
        distanceAtFrame: [0, 0, D, D, D, D, D],
        frames: maps.map((supports, index) => ({
          texture: index === 5 ? "whole-0" : `whole-${index}`,
          rect: [0, 0, 1254, 1254],
          durationMs: 150,
          grip: [778, 640],
          foot: [900, 936],
          head: [
            [728, 154],
            [785, 460],
          ],
          supports: supports as NonNullable<
            SequenceSample["frame"]["supports"]
          >,
        })),
      },
    },
    transitions: [],
  };
}

function exercise(
  player: SequencePlayer,
  cycles: number,
  options: {
    travel?: SequencePoint;
    worldScale?: number;
    startTime?: number;
    clip?: string;
    phaseOffset?: number;
  } = {},
) {
  const travel = options.travel ?? [0, 0];
  const worldScale = options.worldScale ?? 1;
  const samples: { input: SequenceInput; sample: SequenceSample }[] = [];
  let distance = 0;
  let t = options.startTime ?? 0;
  let loops = 0;
  let previous: SequenceSample | undefined;
  for (let tick = 0; tick < cycles * 100 + 1; tick++) {
    if (previous?.frameIndex === 1) {
      const remaining =
        previous.transition!.motionBudget!.remainingDIP / worldScale;
      distance += Math.min(D / 20, remaining);
    }
    const input: SequenceInput = {
      clip: options.clip ?? "stroke",
      t,
      phase: (options.phaseOffset ?? 0) + (distance / D) * TAU,
      travel: [travel[0], travel[1] - distance],
      direction: [0, -1],
      worldScale,
      supportRequired: true,
    };
    const sample = player.sample(input)!;
    samples.push({ input, sample });
    if (sample.motionFailure) break;
    if (previous?.frameIndex === 5 && sample.frameIndex === 0) loops++;
    if (loops === cycles) break;
    previous = sample;
    t += 1 / 60;
  }
  return { samples, loops };
}

function maxRetainedDrift(rows: ReturnType<typeof exercise>["samples"]) {
  let active: Record<string, SequencePoint> = {};
  let max = 0;
  for (const { input, sample } of rows) {
    const next: typeof active = {};
    for (const [name, point] of Object.entries(sample.anchors.supports)) {
      const world: SequencePoint = [
        (point![0] + input.travel![0]) * input.worldScale!,
        (point![1] + input.travel![1]) * input.worldScale!,
      ];
      if (active[name])
        max = Math.max(
          max,
          Math.hypot(world[0] - active[name][0], world[1] - active[name][1]),
        );
      next[name] = active[name] ?? world;
    }
    active = next;
  }
  return max;
}

describe("absolute whole-cel cycle registration", () => {
  it("bounds acquisition error for forty confirmed cycles without accumulating whole offsets", () => {
    const source = resource();
    const frozen = structuredClone(source);
    const { samples, loops } = exercise(new SequencePlayer(source), 40);
    expect(loops).toBe(40);
    expect(samples.every(({ sample }) => !sample.motionFailure)).toBe(true);
    expect(maxRetainedDrift(samples)).toBeLessThanOrEqual(1 + 1e-8);
    const returns = samples.filter(
      ({ sample }) => sample.frameIndex === 0 || sample.frameIndex === 5,
    );
    for (const { sample } of returns) {
      expect(sample.translation[0]).toBeCloseTo(0, 10);
      expect(sample.translation[1]).toBeCloseTo(0, 10);
      expect(sample.scale).toBe(g);
      expect(sample.frame).toEqual(source.clips.stroke.frames[0]);
    }
    expect(samples.at(-1)!.input.travel![1]).toBeCloseTo(-40 * D, 10);
    expect(source).toEqual(frozen);
  });

  it("preserves perfect support trajectories and confirmed travel", () => {
    const { samples, loops } = exercise(new SequencePlayer(resource(true)), 12);
    expect(loops).toBe(12);
    expect(samples.every(({ sample }) => !sample.motionFailure)).toBe(true);
    expect(maxRetainedDrift(samples)).toBeLessThan(1e-10);
    for (const { sample } of samples) {
      const remainingTravel =
        sample.frameIndex === 1
          ? D - sample.transition!.motionBudget!.remainingDIP
          : 0;
      expect(sample.translation[0]).toBeCloseTo(0, 10);
      expect(sample.translation[1]).toBeCloseTo(remainingTravel, 10);
    }
  });

  it("rejects closure that cannot meet every retained support within one DIP", () => {
    const source = resource();
    // Each local material discrepancy is <=3 raw pixels, but the accumulated
    // acquisition registration cannot close against the first whole cel.
    source.clips.stroke.frames[3].supports!.armFar = [970, 239];
    source.clips.stroke.frames[4].supports!.armFar = [971, 239];
    const player = new SequencePlayer(source);
    const { samples, loops } = exercise(player, 1);
    expect(loops).toBe(0);
    expect(
      samples.slice(0, -1).every(({ sample }) => !sample.motionFailure),
    ).toBe(true);
    expect(player.getMotionFailureDetails()?.reason).toBe("support-conflict");
    expect(samples.at(-1)!.sample.frameIndex).toBe(4);
  });

  it("checks strict tolerance at the supplied display scale", () => {
    const player = new SequencePlayer(resource());
    exercise(player, 1, { worldScale: 2 });
    expect(player.getMotionFailureDetails()?.reason).toBe(
      "support-registration-mismatch",
    );
  });

  it("cancellation and rapid resume establish a new absolute travel origin", () => {
    const player = new SequencePlayer(resource());
    expect(exercise(player, 3).loops).toBe(3);
    for (let restart = 0; restart < 3; restart++) {
      player.cancelMotionPlayback();
      const { samples, loops } = exercise(player, 3, {
        travel: [100 + restart, -500],
        startTime: 0,
      });
      expect(loops).toBe(3);
      expect(samples.every(({ sample }) => !sample.motionFailure)).toBe(true);
      for (const axis of [0, 1])
        expect(samples.at(-1)!.sample.translation[axis]).toBeCloseTo(
          samples[0].sample.translation[axis],
          10,
        );
      expect(maxRetainedDrift(samples)).toBeLessThanOrEqual(1 + 1e-8);
    }
  });

  it("a failed first installation cannot create a cycle origin", () => {
    const player = new SequencePlayer(resource());
    expect(
      player.present(
        {
          clip: "stroke",
          t: 0,
          phase: 0,
          travel: [0, 0],
          direction: [0, -1],
          supportRequired: true,
        },
        { kind: "sample" },
        () => false,
      ),
    ).toBeNull();
    const { loops, samples } = exercise(player, 3, {
      travel: [50, -100],
      startTime: 5,
    });
    expect(loops).toBe(3);
    expect(samples.every(({ sample }) => !sample.motionFailure)).toBe(true);
    expect(samples.at(-1)!.sample.translation[0]).toBeCloseTo(0, 10);
    expect(samples.at(-1)!.sample.translation[1]).toBeCloseTo(0, 10);
  });

  it("resuming from a middle cel preserves the paint and bounds every later whole-cel return", () => {
    const timeline = exercise(new SequencePlayer(resource()), 1).samples;
    const player = new SequencePlayer(resource());
    let before: SequenceSample | undefined;
    for (const row of timeline) {
      before = player.sample(row.input)!;
      if (before.frameIndex === 3) break;
    }
    player.cancelMotionPlayback();
    const { samples, loops } = exercise(player, 12, { travel: [30, -200] });
    expect(samples[0].sample.frame).toEqual(before!.frame);
    expect(samples[0].sample.translation).toEqual(before!.translation);
    expect(loops).toBe(12);
    expect(samples.every(({ sample }) => !sample.motionFailure)).toBe(true);
    expect(maxRetainedDrift(samples)).toBeLessThanOrEqual(1 + 1e-8);
    const first: Partial<Record<number, SequencePoint>> = {};
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i].sample;
      if (i > 0 && samples[i - 1].sample.frameIndex === sample.frameIndex)
        continue;
      const origin = first[sample.frameIndex];
      if (origin) {
        for (const axis of [0, 1])
          expect(sample.translation[axis]).toBeCloseTo(origin[axis], 10);
      } else first[sample.frameIndex] = sample.translation;
    }
  });

  it("a denied closure installation rolls back registration and can be retried", () => {
    const timeline = exercise(new SequencePlayer(resource()), 1).samples;
    const boundary = timeline.findIndex(
      ({ sample }) => sample.frameIndex === 5,
    );
    const player = new SequencePlayer(resource());
    for (const row of timeline.slice(0, boundary)) player.sample(row.input);
    const input = timeline[boundary].input;
    expect(
      player.present(input, { kind: "sample" }, (sample) => {
        expect(sample!.frameIndex).toBe(5);
        expect(sample!.translation[0]).toBeCloseTo(0, 10);
        expect(sample!.translation[1]).toBeCloseTo(0, 10);
        return false;
      }),
    ).toBeNull();
    const installed = player.present(input, { kind: "sample" }, () => true)!;
    expect(installed.frameIndex).toBe(5);
    expect(installed.motionFailure).toBeUndefined();
    expect(installed.translation[0]).toBeCloseTo(0, 10);
    expect(installed.translation[1]).toBeCloseTo(0, 10);
  });

  it.each(["rect", "grip", "foot", "head", "contacts", "supports"] as const)(
    "does not treat matching texture with different %s as the canonical whole cel",
    (key) => {
      const source = resource();
      const terminal = source.clips.stroke.frames[5];
      if (key === "rect") terminal.rect[0] += 1;
      else if (key === "head") terminal.head[0][0] += 0.1;
      else if (key === "contacts") terminal.contacts = { top: [973, 239] };
      else if (key === "supports") terminal.supports!.armFar![0] += 0.1;
      else terminal[key][0] += 1;
      const { samples, loops } = exercise(new SequencePlayer(source), 1);
      expect(loops).toBe(1);
      const terminalSample = samples.find(
        ({ sample }) => sample.frameIndex === 5,
      )!.sample;
      expect(Math.hypot(...terminalSample.translation)).toBeGreaterThan(0.1);
      expect(samples.at(-1)!.sample.translation[0]).toBeCloseTo(0, 10);
      expect(samples.at(-1)!.sample.translation[1]).toBeCloseTo(0, 10);
    },
  );

  it("a display scale change replaces the old cycle origin", () => {
    const player = new SequencePlayer(resource());
    expect(exercise(player, 3).loops).toBe(3);
    const { samples, loops } = exercise(player, 3, {
      worldScale: 0.5,
      travel: [50, -100],
      startTime: 20,
      phaseOffset: 3 * TAU,
    });
    expect(loops).toBe(3);
    expect(samples.every(({ sample }) => !sample.motionFailure)).toBe(true);
    const firstReturn = samples.find(
      ({ sample }) => sample.frameIndex === 0,
    )!.sample;
    for (const axis of [0, 1])
      expect(samples.at(-1)!.sample.translation[axis]).toBeCloseTo(
        firstReturn.translation[axis],
        10,
      );
  });

  it("changing clips through an actual whole-cel bridge starts a new cycle origin", () => {
    const source = resource();
    source.clips.next = structuredClone(source.clips.stroke);
    source.clips.bridge = {
      loop: false,
      frames: [structuredClone(source.clips.stroke.frames[0])],
    };
    source.transitions = [
      { id: "switch", from: "stroke", to: "next", clip: "bridge" },
    ];
    const player = new SequencePlayer(source);
    expect(exercise(player, 2).loops).toBe(2);
    const input: SequenceInput = {
      clip: "next",
      t: 20,
      phase: 0,
      travel: [50, -100],
      direction: [0, -1],
      supportRequired: true,
    };
    expect(player.sample(input)!.motionFailure).toBeUndefined();
    expect(player.sample({ ...input, t: 21 })!.clip).toBe("next");
    const { samples, loops } = exercise(player, 3, {
      clip: "next",
      travel: [50, -100],
      startTime: 21,
    });
    expect(loops).toBe(3);
    expect(samples.every(({ sample }) => !sample.motionFailure)).toBe(true);
    for (const axis of [0, 1])
      expect(samples.at(-1)!.sample.translation[axis]).toBeCloseTo(
        samples[0].sample.translation[axis],
        10,
      );
  });
});
