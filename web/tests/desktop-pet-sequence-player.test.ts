import { describe, expect, it } from "vitest";
import { SequencePlayer } from "@features/desktop-pet/sequences/player";
import type {
  FrameSequences,
  SequenceFrame,
  SequenceInput,
} from "@features/desktop-pet/sequences/types";

const cel = (index: number, durationMs = 100): SequenceFrame => ({
  texture: "whole",
  rect: [index * 100, 200, 100, 200],
  durationMs,
  grip: [50, 70],
  foot: [50, 190],
  head: [
    [50, 10],
    [50, 50],
  ],
  contacts: { left: [10, 100] },
  supports: { legFront: [50, 190] },
});
const fixture = (): FrameSequences => ({
  version: 1,
  frameSize: [100, 200],
  modelBox: [20, 30, 50, 100],
  headLength: 20,
  clips: {
    idle: { frames: [cel(0), cel(1)], loop: true },
    "walk-right": {
      frames: [cel(2), cel(3, 300)],
      loop: true,
      distancePerCycle: 60,
    },
    held: { frames: [cel(4), cel(5)], loop: true },
    drop: { frames: [cel(6), cel(7)], loop: false },
    entry: { frames: [cel(0), cel(8), cel(2)], loop: false },
    exit: { frames: [cel(2), cel(3), cel(9), cel(0)], loop: false },
    grab: { frames: [cel(2), cel(10), cel(4)], loop: false },
    release: { frames: [cel(4), cel(11), cel(6)], loop: false },
    recovery: { frames: [cel(8), cel(12), cel(4)], loop: false },
  },
  transitions: [
    { id: "start", from: "idle", to: "walk-right", clip: "entry" },
    { id: "stop", from: "walk-right", to: "idle", clip: "exit" },
    { id: "pickup", from: "walk-right", to: "held", clip: "grab" },
    { id: "release", from: "held", to: "drop", clip: "release" },
    { id: "interrupt", from: "entry", to: "held", clip: "recovery" },
  ],
});
const sample = (player: SequencePlayer, input: SequenceInput) => {
  const result = player.sample(input);
  expect(result).not.toBeNull();
  return result!;
};

describe("complete cel sequence playback", () => {
  it("keeps global size and source-local anchors across atlas origins and actions", () => {
    const player = new SequencePlayer(fixture());
    const idle = sample(player, { clip: "idle", t: 0 });
    const next = sample(player, { clip: "idle", t: 0.1 });
    expect(next.frame.rect[0]).toBe(100);
    expect(next.scale).toBe(0.5);
    expect(next.modelBox).toEqual(idle.modelBox);
    expect(next.anchors).toEqual(idle.anchors);
    expect(next.anchors.grip).toEqual([45, 65]);
    expect(next.anchors.foot).toEqual([45, 125]);
    expect(next.anchors.contacts.left).toEqual([25, 80]);
    expect(next.anchors.supports.legFront).toEqual([45, 125]);
    const held = sample(new SequencePlayer(fixture()), { clip: "held", t: 0 });
    expect(held.scale).toBe(idle.scale);
    expect(held.modelBox).toEqual(idle.modelBox);
  });
  it.each(["walk-right", "held", "drop"])(
    "rejects cranial drift in %s without fitting the cel",
    (clip) => {
      const pack = fixture();
      pack.clips[clip].frames[1].head[1][1] = 51;
      const player = new SequencePlayer(pack);
      const initial = sample(player, { clip: "idle", t: 0 });
      const rejected = sample(player, { clip, t: 0.1, phase: 0 });
      expect(rejected.motionFailure?.reason).toBe("head-scale-mismatch");
      expect(rejected.frame).toEqual(initial.frame);
      expect(rejected.scale).toBe(initial.scale);
    },
  );
  it("accepts exactly 2% head registration tolerance without altering scale", () => {
    const pack = fixture();
    pack.clips.idle.frames[1].head[1][1] = 50.8;
    const player = new SequencePlayer(pack);
    sample(player, { clip: "idle", t: 0 });
    expect(sample(player, { clip: "idle", t: 0.1 }).scale).toBe(0.5);
    expect(player.getMotionFailure()).toBeNull();
  });
  it("refuses nonuniform global layout rather than stretching source", () => {
    const pack = fixture();
    pack.modelBox[3] = 99;
    const player = new SequencePlayer(pack);
    expect(player.sample({ clip: "idle", t: 0 })).toBeNull();
    expect(player.getMotionFailureDetails()?.reason).toBe("invalid-layout");
  });
  it("anchors by translation only and rejects conflicting grip/foot requests", () => {
    const player = new SequencePlayer(fixture());
    const result = sample(player, { clip: "held", t: 0, grip: [100, 100] });
    expect(result.translation).toEqual([55, 35]);
    expect(result.anchors.grip).toEqual([100, 100]);
    expect(result.anchors.foot).toEqual([100, 160]);
    const failure = sample(player, {
      clip: "held",
      t: 0.1,
      grip: [100, 100],
      foot: [100, 150],
    });
    expect(failure.motionFailure?.reason).toBe("anchor-conflict");
    expect(failure.frame).toEqual(result.frame);
    expect(failure.translation).toEqual(result.translation);
    player.cancelMotionPlayback();
    const recovered = sample(player, {
      clip: "held",
      t: 0,
      grip: [100, 100],
      foot: [100, 160],
    });
    expect(recovered.frame).toEqual(result.frame);
  });
  it("advances walk only by confirmed phase with duration-weighted cels", () => {
    const player = new SequencePlayer(fixture());
    const first = sample(player, { clip: "walk-right", t: 0, phase: 0 });
    expect(
      sample(player, { clip: "walk-right", t: 100, phase: 0 }).frame,
    ).toEqual(first.frame);
    const swing = sample(player, {
      clip: "walk-right",
      t: 101,
      phase: Math.PI / 2,
    });
    expect(swing.frameIndex).toBe(1);
    expect(swing.distancePerCycle).toBe(60);
    expect(
      sample(player, { clip: "walk-right", t: 102, phase: 2 * Math.PI })
        .frameIndex,
    ).toBe(0);
  });
  it("reports missing phase, clip and empty frames explicitly", () => {
    const player = new SequencePlayer(fixture());
    expect(player.sample({ clip: "walk-right", t: 0 })).toBeNull();
    expect(player.getMotionFailureDetails()?.reason).toBe("missing-phase");
    expect(player.sample({ clip: "unknown", t: 0 })).toBeNull();
    expect(player.getMotionFailureDetails()?.reason).toBe("missing-clip");
    const pack = fixture();
    pack.clips.held.frames = [];
    const empty = new SequencePlayer(pack);
    expect(empty.sample({ clip: "held", t: 0 })).toBeNull();
    expect(empty.getMotionFailureDetails()?.reason).toBe("missing-frame");
  });
  it("plays actual entry cels before allowing phase progression", () => {
    const player = new SequencePlayer(fixture());
    sample(player, { clip: "idle", t: 0 });
    const enter = sample(player, { clip: "walk-right", t: 0.01, phase: 0 });
    expect(enter.clip).toBe("entry");
    expect(enter.frame).toEqual(cel(0));
    expect(enter.distancePerCycle).toBe(60);
    expect(player.getMotionTransition()).toEqual({ id: "start", progress: 0 });
    const middle = sample(player, { clip: "walk-right", t: 0.11, phase: 12 });
    expect(middle.frame).toEqual(cel(8));
    expect(middle.transition?.progress).toBeCloseTo(1 / 3);
    const final = sample(player, { clip: "walk-right", t: 0.32, phase: 12 });
    expect(final.clip).toBe("walk-right");
    expect(final.frame).toEqual(cel(2));
    expect(player.getMotionTransition()).toBeNull();
    expect(
      sample(player, { clip: "walk-right", t: 20, phase: 12 }).frame,
    ).toEqual(final.frame);
    expect(
      sample(player, { clip: "walk-right", t: 21, phase: 12 + Math.PI })
        .frameIndex,
    ).toBe(1);
  });
  it("exits at a registered current phase cel without replacing it", () => {
    const player = new SequencePlayer(fixture());
    const walking = sample(player, {
      clip: "walk-right",
      t: 0,
      phase: Math.PI,
    });
    const stop = sample(player, { clip: "idle", t: 0.1 });
    // The same painted cel may intentionally have a different stop hold time.
    expect(stop.frame.rect).toEqual(walking.frame.rect);
    expect(stop.frame.texture).toBe(walking.frame.texture);
    expect(stop.anchors).toEqual(walking.anchors);
    expect(stop.frameIndex).toBe(1);
    expect(stop.transition).toEqual({ id: "stop", progress: 0 });
    expect(sample(player, { clip: "idle", t: 0.21 }).frame).toEqual(cel(9));
    expect(sample(player, { clip: "idle", t: 0.41 }).frame).toEqual(cel(0));
  });
  it.each(["missing", "entry", "exit", "registration"])(
    "holds actual cel for unsafe %s transition",
    (kind) => {
      const pack = fixture();
      if (kind === "missing") pack.transitions = [];
      if (kind === "entry") pack.clips.entry.frames[0] = cel(22);
      if (kind === "exit") pack.clips.entry.frames[2] = cel(23);
      if (kind === "registration") pack.clips.entry.frames[0].grip = [51, 70];
      const player = new SequencePlayer(pack);
      const idle = sample(player, { clip: "idle", t: 0 });
      const rejected = sample(player, { clip: "walk-right", t: 1, phase: 0 });
      expect(rejected.frame).toEqual(idle.frame);
      expect(rejected.clip).toBe("idle");
      expect(player.getMotionTransition()).toBeNull();
      expect(rejected.motionFailure?.reason).toBe(
        kind === "missing"
          ? "missing-transition"
          : kind === "exit"
            ? "transition-exit-mismatch"
            : "transition-entry-mismatch",
      );
    },
  );
  it("interrupts only through an actual middle-cel recovery resource", () => {
    const player = new SequencePlayer(fixture());
    sample(player, { clip: "idle", t: 0 });
    sample(player, { clip: "walk-right", t: 0.01, phase: 0 });
    const middle = sample(player, { clip: "walk-right", t: 0.12, phase: 0 });
    const interrupt = sample(player, { clip: "held", t: 0.13 });
    expect(interrupt.frame).toEqual(middle.frame);
    expect(interrupt.transition?.id).toBe("interrupt");
    expect(sample(player, { clip: "held", t: 0.44 }).frame).toEqual(cel(4));
  });
  it("rejects rapid selection without middle recovery and clears stale progress", () => {
    const player = new SequencePlayer(fixture());
    sample(player, { clip: "idle", t: 0 });
    sample(player, { clip: "walk-right", t: 0.01, phase: 0 });
    const middle = sample(player, { clip: "walk-right", t: 0.12, phase: 0 });
    const rejected = sample(player, { clip: "drop", t: 0.13 });
    expect(rejected.frame).toEqual(middle.frame);
    expect(rejected.motionFailure?.reason).toBe("missing-transition");
    expect(player.getMotionTransition()).toBeNull();
    player.cancelMotionPlayback();
    const resume = sample(player, { clip: "walk-right", t: 0, phase: 0 });
    expect(resume.frame).toEqual(middle.frame);
    expect(resume.transition?.id).toBe("start");
  });
  it.each(["idle", "held", "walk-right"])(
    "same %s replay preserves cel and rebases elapsed time/phase",
    (clip) => {
      const player = new SequencePlayer(fixture());
      sample(player, { clip, t: 0, phase: 0 });
      const middle = sample(player, { clip, t: 0.15, phase: Math.PI });
      player.cancelMotionPlayback();
      const restarted = sample(player, { clip, t: 50, phase: 0 });
      expect(restarted.frame).toEqual(middle.frame);
      expect(sample(player, { clip, t: 50.01, phase: 0 }).frame).toEqual(
        middle.frame,
      );
      expect(
        sample(player, { clip, t: 50.11, phase: Math.PI }).frameIndex,
      ).toBe(0);
    },
  );
  it("nonloop drop publishes full duration then holds its terminal cel", () => {
    const player = new SequencePlayer(fixture());
    expect(sample(player, { clip: "drop", t: 0 }).transition).toEqual({
      id: "drop",
      progress: 0,
    });
    expect(
      sample(player, { clip: "drop", t: 0.1 }).transition?.progress,
    ).toBeCloseTo(0.5);
    const terminal = sample(player, { clip: "drop", t: 0.2 });
    expect(terminal.frameIndex).toBe(1);
    expect(terminal.transition).toBeUndefined();
    expect(sample(player, { clip: "drop", t: 100 }).frame).toEqual(
      terminal.frame,
    );
    player.cancelMotionPlayback();
    expect(sample(player, { clip: "drop", t: 0 }).frame).toEqual(
      terminal.frame,
    );
  });
  it("rejects backward clock until explicit cancellation rebases it", () => {
    const player = new SequencePlayer(fixture());
    sample(player, { clip: "held", t: 0 });
    const middle = sample(player, { clip: "held", t: 0.15 });
    expect(
      sample(player, { clip: "held", t: 0.12 }).motionFailure?.reason,
    ).toBe("invalid-time");
    player.cancelMotionPlayback();
    expect(sample(player, { clip: "held", t: 0 }).frame).toEqual(middle.frame);
  });
  it("does not catch up a frozen old request after a rejected selection", () => {
    const player = new SequencePlayer(fixture());
    sample(player, { clip: "held", t: 0 });
    const actual = sample(player, { clip: "held", t: 0.15 });
    sample(player, { clip: "idle", t: 100 });
    const resume = sample(player, { clip: "held", t: 200 });
    expect(resume.frame).toEqual(actual.frame);
    expect(resume.motionFailure).toBeUndefined();
    expect(sample(player, { clip: "held", t: 200.06 }).frameIndex).toBe(0);
  });
  it("isolates resource and returned samples from external mutation", () => {
    const pack = fixture();
    const player = new SequencePlayer(pack);
    pack.clips.idle.frames[0].head[1][1] = 100;
    const first = sample(player, { clip: "idle", t: 0 });
    first.frame.rect[2] = 2;
    first.anchors.grip[0] = -100;
    const next = sample(player, { clip: "idle", t: 0.01 });
    expect(next.frame.rect[2]).toBe(100);
    expect(next.anchors.grip[0]).toBe(45);
    expect(player.getMotionFailure()).toBeNull();
  });
});
