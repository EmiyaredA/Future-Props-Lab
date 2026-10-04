import type {
  FrameSequences,
  SequenceClip,
  SequenceFailure,
  SequenceFrame,
  SequenceInput,
  SequencePoint,
  SequenceProgress,
  SequenceSample,
} from "./types";

type Playback = {
  clip: string;
  target: string;
  start: number | null;
  lastTime: number | null;
  offset: number;
  position: number;
  phaseOrigin: number;
  entry: number;
  transition?: string;
};
const TAU = Math.PI * 2;
const modulo = (n: number, d: number) => ((n % d) + d) % d;
const duration = (clip: SequenceClip) =>
  clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
const samePoint = (a: SequencePoint, b: SequencePoint) =>
  a[0] === b[0] && a[1] === b[1];
const sameAnchors = (
  a: SequenceFrame["contacts"] | SequenceFrame["supports"],
  b: SequenceFrame["contacts"] | SequenceFrame["supports"],
) => {
  const first = Object.entries(a ?? {}).sort();
  const second = Object.entries(b ?? {}).sort();
  return (
    first.length === second.length &&
    first.every(
      ([key, point], i) =>
        key === second[i][0] && samePoint(point, second[i][1]),
    )
  );
};
/** Conservative v1 painted identity. Metadata alone cannot prove two cels equal. */
const sameCel = (a: SequenceFrame, b: SequenceFrame) =>
  a.texture === b.texture &&
  a.rect.every((value, i) => value === b.rect[i]) &&
  samePoint(a.grip, b.grip) &&
  samePoint(a.foot, b.foot) &&
  a.head.every((point, i) => samePoint(point, b.head[i])) &&
  sameAnchors(a.contacts, b.contacts) &&
  sameAnchors(a.supports, b.supports);
const finitePoint = (point: SequencePoint) => point.every(Number.isFinite);

/** Chooses complete source cels; no mesh, rotation, per-cel fitting or alpha blend. */
export class SequencePlayer {
  private readonly sequences: FrameSequences;
  private readonly scale: number;
  private playback: Playback | null = null;
  private last: SequenceSample | null = null;
  private failure: SequenceFailure | null = null;
  private failedRequest: string | null = null;
  private progress: SequenceProgress | null = null;

  constructor(sequences: FrameSequences) {
    this.sequences = structuredClone(sequences);
    this.scale = sequences.modelBox[2] / sequences.frameSize[0];
  }

  getMotionFailure(): string | null {
    return this.failure ? `sequence:${this.failure.reason}` : null;
  }

  getMotionFailureDetails(): SequenceFailure | null {
    return this.failure ? { ...this.failure } : null;
  }

  getMotionTransition(): SequenceProgress | null {
    return this.progress ? { ...this.progress } : null;
  }

  /** Keeps the displayed cel, rebases both clocks, and cancels stale feedback. */
  cancelMotionPlayback(): void {
    if (this.playback) {
      this.playback.start = null;
      this.playback.lastTime = null;
      this.playback.offset = this.playback.position;
    }
    this.failure = null;
    this.failedRequest = null;
    this.progress = null;
    if (this.last) {
      delete this.last.transition;
      delete this.last.motionFailure;
    }
  }

  private reject(reason: SequenceFailure["reason"], request: string) {
    this.failure = { reason, clip: request };
    this.failedRequest = request;
    this.progress = null;
    if (!this.last) return null;
    const sample = structuredClone(this.last);
    sample.requestedClip = request;
    sample.motionFailure = { ...this.failure };
    delete sample.transition;
    return sample;
  }

  private checkClip(id: string): SequenceFailure["reason"] | null {
    const { frameSize, modelBox, headLength } = this.sequences;
    if (
      !frameSize.every((v) => Number.isFinite(v) && v > 0) ||
      !modelBox.every(Number.isFinite) ||
      modelBox[2] <= 0 ||
      modelBox[3] <= 0 ||
      !Number.isFinite(headLength) ||
      headLength <= 0 ||
      Math.abs(this.scale / (modelBox[3] / frameSize[1]) - 1) > 1e-6
    )
      return "invalid-layout";
    const clip = this.sequences.clips[id];
    if (!clip) return "missing-clip";
    if (!clip.frames.length) return "missing-frame";
    if (
      clip.distancePerCycle !== undefined &&
      (!clip.loop ||
        !Number.isFinite(clip.distancePerCycle) ||
        clip.distancePerCycle <= 0)
    )
      return "invalid-frame";
    for (const frame of clip.frames) {
      if (
        !frame.texture ||
        !frame.rect.every(Number.isFinite) ||
        frame.rect[2] !== frameSize[0] ||
        frame.rect[3] !== frameSize[1] ||
        !Number.isFinite(frame.durationMs) ||
        frame.durationMs <= 0 ||
        !finitePoint(frame.grip) ||
        !finitePoint(frame.foot) ||
        !frame.head.every(finitePoint)
      )
        return "invalid-frame";
      const cranial = Math.hypot(
        frame.head[1][0] - frame.head[0][0],
        frame.head[1][1] - frame.head[0][1],
      );
      if (Math.abs((cranial * this.scale) / headLength - 1) > 0.0200000001)
        return "head-scale-mismatch";
    }
    return null;
  }

  private select(input: SequenceInput): SequenceFailure["reason"] | null {
    const target = this.sequences.clips[input.clip];
    if (!this.playback || !this.last) {
      this.playback = {
        clip: input.clip,
        target: input.clip,
        start: input.t,
        lastTime: null,
        offset: 0,
        position: 0,
        phaseOrigin: 0,
        entry: 0,
      };
      return null;
    }
    if (this.playback.target === input.clip) return null;
    const link = this.sequences.transitions.find(
      (item) => item.from === this.playback?.clip && item.to === input.clip,
    );
    if (!link) return "missing-transition";
    const invalid = this.checkClip(link.clip);
    if (invalid) return invalid;
    const bridge = this.sequences.clips[link.clip];
    if (bridge.loop || bridge.distancePerCycle !== undefined)
      return "invalid-frame";
    const index = bridge.frames.findIndex((frame) =>
      sameCel(frame, this.last!.frame),
    );
    if (index < 0) return "transition-entry-mismatch";
    if (!sameCel(bridge.frames.at(-1)!, target.frames[0]))
      return "transition-exit-mismatch";
    const entry = bridge.frames
      .slice(0, index)
      .reduce((sum, frame) => sum + frame.durationMs, 0);
    this.playback = {
      clip: link.clip,
      target: input.clip,
      start: input.t,
      lastTime: null,
      offset: entry,
      position: entry,
      phaseOrigin: 0,
      entry,
      transition: link.id,
    };
    return null;
  }

  sample(input: SequenceInput): SequenceSample | null {
    const prior = this.playback ? { ...this.playback } : null;
    const result = this.sampleNext(input);
    if (this.failure) {
      this.playback = prior;
      // A rejected selection freezes the actual cel; returning to the previous
      // request must not catch up its old wall clock or confirmed phase.
      if (prior) {
        prior.start = null;
        prior.lastTime = null;
        prior.offset = prior.position;
      }
    }
    return result;
  }

  private sampleNext(input: SequenceInput): SequenceSample | null {
    if (this.failedRequest === input.clip && this.failure)
      return this.reject(this.failure.reason, input.clip);
    this.failure = null;
    this.failedRequest = null;
    if (!Number.isFinite(input.t))
      return this.reject("invalid-time", input.clip);
    const invalid = this.checkClip(input.clip);
    if (invalid) return this.reject(invalid, input.clip);
    const target = this.sequences.clips[input.clip];
    if (
      target.distancePerCycle !== undefined &&
      (input.phase === undefined || !Number.isFinite(input.phase))
    )
      return this.reject("missing-phase", input.clip);
    const changed = this.select(input);
    if (changed) return this.reject(changed, input.clip);
    const run = this.playback!;
    let clip = this.sequences.clips[run.clip];
    if (run.start === null) {
      run.start = input.t;
      run.phaseOrigin = input.phase ?? 0;
    }
    if (
      input.t < run.start ||
      (run.lastTime !== null && input.t < run.lastTime)
    )
      return this.reject("invalid-time", input.clip);
    run.lastTime = input.t;
    const total = duration(clip);
    let position =
      clip.distancePerCycle !== undefined
        ? run.offset + (((input.phase ?? 0) - run.phaseOrigin) / TAU) * total
        : run.offset + (input.t - run.start) * 1000;
    this.progress = null;
    if (run.transition && position >= total) {
      // The terminal painted cel is exactly the destination's first cel.
      run.clip = run.target;
      run.start = input.t;
      run.offset = 0;
      run.phaseOrigin = input.phase ?? 0;
      run.entry = 0;
      delete run.transition;
      clip = target;
      position = 0;
    } else if (run.transition) {
      this.progress = {
        id: run.transition,
        progress: Math.max(0, (position - run.entry) / (total - run.entry)),
      };
    } else if (!clip.loop && position < total) {
      this.progress = {
        id: run.clip,
        progress: Math.max(0, position / total),
      };
    }
    run.position = clip.loop
      ? modulo(position, duration(clip))
      : Math.min(Math.max(position, 0), duration(clip));
    let remaining = run.position;
    let frameIndex = 0;
    while (
      frameIndex < clip.frames.length - 1 &&
      remaining >= clip.frames[frameIndex].durationMs
    ) {
      remaining -= clip.frames[frameIndex].durationMs;
      frameIndex++;
    }
    const frame = clip.frames[frameIndex];
    const project = (
      point: SequencePoint,
      translation: SequencePoint,
    ): SequencePoint => [
      this.sequences.modelBox[0] + point[0] * this.scale + translation[0],
      this.sequences.modelBox[1] + point[1] * this.scale + translation[1],
    ];
    let translation: SequencePoint = this.last?.translation ?? [0, 0];
    const offsets: SequencePoint[] = [];
    for (const key of ["grip", "foot"] as const) {
      const desired = input[key];
      if (desired) {
        if (!finitePoint(desired))
          return this.reject("anchor-conflict", input.clip);
        const base = project(frame[key], [0, 0]);
        offsets.push([desired[0] - base[0], desired[1] - base[1]]);
      }
    }
    if (
      offsets.length === 2 &&
      Math.hypot(offsets[0][0] - offsets[1][0], offsets[0][1] - offsets[1][1]) >
        1e-8
    )
      return this.reject("anchor-conflict", input.clip);
    if (offsets[0]) translation = offsets[0];
    const projectedMap = <K extends string>(
      map?: Partial<Record<K, SequencePoint>>,
    ) =>
      Object.fromEntries(
        Object.entries(map ?? {}).map(([key, point]) => [
          key,
          project(point as SequencePoint, translation),
        ]),
      ) as Partial<Record<K, SequencePoint>>;
    const sample: SequenceSample = {
      clip: run.clip,
      requestedClip: input.clip,
      frameIndex,
      frame,
      modelBox: this.sequences.modelBox,
      scale: this.scale,
      translation,
      anchors: {
        grip: project(frame.grip, translation),
        foot: project(frame.foot, translation),
        head: [
          project(frame.head[0], translation),
          project(frame.head[1], translation),
        ],
        contacts: projectedMap(frame.contacts),
        supports: projectedMap(frame.supports),
      },
    };
    if (target.distancePerCycle !== undefined)
      sample.distancePerCycle = target.distancePerCycle;
    if (this.progress) sample.transition = { ...this.progress };
    this.last = structuredClone(sample);
    return structuredClone(sample);
  }
}
