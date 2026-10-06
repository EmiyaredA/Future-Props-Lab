import {
  sameSequenceCel as sameCel,
  transitionBranchFailure,
  transitionSegmentForFrame,
  isTransitionContainer,
  transitionSourceForSample,
} from "./transitions";
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
import {
  sampleDistanceStage,
  validDistanceStages,
  type DistanceStage,
} from "./distanceStages";

type Playback = {
  clip: string;
  target: string;
  start: number | null;
  lastTime: number | null;
  offset: number;
  position: number;
  phaseOrigin: number;
  begin: number;
  end: number;
  transition?: string;
  distanceStage?: DistanceStage;
  owner: number;
};
type SupportName = keyof NonNullable<SequenceFrame["supports"]>;
type Support = {
  world: SequencePoint;
  source: SequencePoint;
  referenceTravel: SequencePoint;
};
type CycleRegistration = {
  frame: SequenceFrame;
  reference: number;
  phase: number;
  travel: SequencePoint;
  translation: SequencePoint;
};
type SupportPlayback = {
  clip: string;
  actualClip: string;
  reference: number;
  referenceTravel: SequencePoint;
  scale: number;
  travel: SequencePoint;
  phase: number;
  direction: SequencePoint | null;
  points: Partial<Record<SupportName, Support>>;
  cycleOrigins?: CycleRegistration[];
};
const TAU = Math.PI * 2;
const modulo = (n: number, d: number) => ((n % d) + d) % d;
const duration = (clip: SequenceClip) =>
  clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
const finitePoint = (point: SequencePoint) =>
  Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

export type SequencePresentationRequest =
  | { kind: "sample" }
  | { kind: "hold" }
  | { kind: "reject"; reason: SequenceFailure["reason"] };

/** Chooses complete source cels; no mesh, rotation, per-cel fitting or alpha blend. */
export class SequencePlayer {
  private readonly sequences: FrameSequences;
  private readonly scale: number;
  private playback: Playback | null = null;
  private last: SequenceSample | null = null;
  private failure: SequenceFailure | null = null;
  private failedRequest: string | null = null;
  private progress: SequenceProgress | null = null;
  private support: SupportPlayback | null = null;
  private rejectedSupport: SupportPlayback | null = null;
  private presenting = false;
  private stageGeneration = 0;

  constructor(sequences: FrameSequences) {
    this.sequences = structuredClone(sequences);
    this.scale = sequences.modelBox[2] / sequences.frameSize[0];
  }

  /** Commit sampled state only with synchronous presentation; ordinary rejects remain rejects. */
  present(
    input: SequenceInput,
    request: SequencePresentationRequest,
    install: (sample: SequenceSample | null) => boolean,
  ): SequenceSample | null {
    if (this.presenting) throw new Error("完整序列帧呈现不能重入");
    if (install.constructor.name === "AsyncFunction")
      throw new Error("完整序列帧呈现必须返回同步安装结果");
    // Only dynamic state is copied, never the resource/atlas description.
    const prior = structuredClone({
      playback: this.playback,
      last: this.last,
      failure: this.failure,
      failedRequest: this.failedRequest,
      progress: this.progress,
      support: this.support,
      rejectedSupport: this.rejectedSupport,
    });
    this.presenting = true;
    try {
      const sample =
        request.kind === "hold"
          ? this.holdMotionPlayback(input)
          : request.kind === "reject"
            ? this.rejectMotionPlayback(input, request.reason)
            : this.sample(input);
      const installed = install(sample);
      if (typeof installed !== "boolean")
        throw new Error("完整序列帧呈现必须返回同步安装结果");
      if (!installed && !this.failure) {
        this.playback = prior.playback;
        this.last = prior.last;
        this.failedRequest = prior.failedRequest;
        this.progress = prior.progress;
        this.support = prior.support;
        this.rejectedSupport = prior.rejectedSupport;
      }
      return installed ? sample : null;
    } catch (error: unknown) {
      this.playback = prior.playback;
      this.last = prior.last;
      this.failure = prior.failure;
      this.failedRequest = prior.failedRequest;
      this.progress = prior.progress;
      this.support = prior.support;
      this.rejectedSupport = prior.rejectedSupport;
      throw error;
    } finally {
      this.presenting = false;
    }
  }

  /** End a completed physical exit; preserve the cel and its registration. */
  endMotionSupport(): void {
    this.support = null;
    this.rejectedSupport = null;
  }

  getMotionFailure(): string | null {
    return this.failure ? `sequence:${this.failure.reason}` : null;
  }

  getMotionFailureDetails(): SequenceFailure | null {
    return this.failure ? { ...this.failure } : null;
  }

  getMotionTransition(): SequenceProgress | null {
    return this.progress ? structuredClone(this.progress) : null;
  }

  /** Keeps the displayed cel, rebases both clocks, and cancels stale feedback. */
  cancelMotionPlayback(): void {
    if (this.playback) {
      this.playback.start = null;
      this.playback.lastTime = null;
      this.playback.offset = this.playback.position;
      this.playback.owner = ++this.stageGeneration;
      if (this.playback.distanceStage) {
        this.playback.distanceStage = {
          ...this.playback.distanceStage,
          phaseOrigin: null,
          enteredAt: null,
        };
      }
    }
    this.failure = null;
    this.failedRequest = null;
    this.progress = null;
    this.support = null;
    this.rejectedSupport = null;
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
    if (!validDistanceStages(clip)) return "invalid-frame";
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
        !frame.head.every(finitePoint) ||
        [frame.supports, frame.contacts].some((map) =>
          Object.values(map ?? {}).some(
            (point) =>
              !finitePoint(point) ||
              point.some((value, axis) => value < 0 || value > frameSize[axis]),
          ),
        )
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
        begin: 0,
        end: target.frames.length,
        owner: ++this.stageGeneration,
      };
      return null;
    }
    if (this.playback.target === input.clip) return null;
    const source = transitionSourceForSample(this.sequences, this.last);
    const link =
      this.sequences.transitions.find(
        (item) => item.from === this.last?.clip && item.to === input.clip,
      ) ??
      this.sequences.transitions.find(
        (item) => item.from === source.clip && item.to === input.clip,
      );
    if (!link) return "missing-transition";
    const branchFailure = transitionBranchFailure(this.sequences, link);
    if (branchFailure) return branchFailure;
    const segment = transitionSegmentForFrame(
      this.sequences,
      link,
      link.from === this.last.clip ? this.last.frameIndex : source.frameIndex,
    );
    if (!segment) return "missing-transition-branch";
    const selectedClip = segment.clip;
    const invalid = this.checkClip(selectedClip);
    if (invalid) return invalid;
    const bridge = this.sequences.clips[selectedClip];
    if (bridge.loop || bridge.distancePerCycle !== undefined)
      return "invalid-frame";
    const index = link.branches
      ? sameCel(bridge.frames[segment.start], this.last.frame)
        ? segment.start
        : -1
      : bridge.frames.findIndex((frame) => sameCel(frame, this.last!.frame));
    if (index < 0) return "transition-entry-mismatch";
    if (!sameCel(bridge.frames[segment.end - 1], target.frames[0]))
      return "transition-exit-mismatch";
    this.playback = {
      clip: selectedClip,
      target: input.clip,
      start: input.t,
      lastTime: null,
      offset: 0,
      position: 0,
      phaseOrigin: 0,
      begin: index,
      end: segment.end,
      transition: link.id,
      owner: ++this.stageGeneration,
    };
    return null;
  }

  /** Check painted registrations first, then translate one whole cel around its real supports. */
  private supportTranslation(
    input: SequenceInput,
    clip: SequenceClip,
    actualClip: string,
    frame: SequenceFrame,
    reference: number,
    translation: SequencePoint,
  ):
    | { translation: SequencePoint; support: SupportPlayback }
    | SequenceFailure["reason"] {
    const travel = input.travel!;
    const scale = input.worldScale ?? 1;
    const phase = input.phase ?? 0;
    if (!finitePoint(travel) || !Number.isFinite(scale) || scale <= 0)
      return "invalid-support-motion";
    const entries = Object.entries(frame.supports ?? {}) as [
      SupportName,
      SequencePoint,
    ][];
    if (!entries.length) return "missing-support";
    const prior = this.support?.scale === scale ? this.support : null;
    const sameClip = prior?.actualClip === actualClip;
    let direction = input.direction ?? prior?.direction ?? null;
    if (
      direction &&
      (!finitePoint(direction) || Math.abs(Math.hypot(...direction) - 1) > 1e-6)
    )
      return "invalid-support-motion";
    if (prior && sameClip && clip.distancePerCycle !== undefined) {
      const delta: SequencePoint = [
        travel[0] - prior.travel[0],
        travel[1] - prior.travel[1],
      ];
      const distance = Math.hypot(...delta);
      const deltaPhase = phase - prior.phase;
      if (deltaPhase < -1e-8 || (distance > 1e-8 && deltaPhase <= 0))
        return "invalid-support-motion";
      if (
        deltaPhase > 1e-8 &&
        Math.abs(distance - (deltaPhase / TAU) * clip.distancePerCycle) *
          scale >
          1e-6
      )
        return "invalid-support-motion";
      if (distance > 1e-8) {
        const confirmed: SequencePoint = [
          delta[0] / distance,
          delta[1] / distance,
        ];
        if (
          direction &&
          Math.hypot(confirmed[0] - direction[0], confirmed[1] - direction[1]) >
            1e-6
        )
          return "invalid-support-motion";
        direction = confirmed;
      }
    }
    const referenceTravel: SequencePoint = prior
      ? [...prior.referenceTravel]
      : [0, 0];
    if (prior && sameClip && clip.distancePerCycle !== undefined) {
      const advance = (reference - prior.reference) * clip.distancePerCycle;
      if (Math.abs(advance) > 1e-8) {
        if (!direction) return "invalid-support-motion";
        referenceTravel[0] += direction[0] * advance;
        referenceTravel[1] += direction[1] * advance;
      }
    }
    const project = (point: SequencePoint): SequencePoint => [
      this.sequences.modelBox[0] + point[0] * this.scale,
      this.sequences.modelBox[1] + point[1] * this.scale,
    ];
    const common = entries.filter(([name]) => prior?.points[name]);
    if (prior && !common.length) return "support-handoff-missing";
    const offsets: SequencePoint[] = [];
    for (const [name, point] of common) {
      const old = prior!.points[name]!;
      const source = project(point);
      // Timed bridges have no nominal window displacement: the same painted
      // support must stay at the same registered pixel, not be rescued by a fit.
      if (
        Math.hypot(
          source[0] -
            old.source[0] +
            referenceTravel[0] -
            old.referenceTravel[0],
          source[1] -
            old.source[1] +
            referenceTravel[1] -
            old.referenceTravel[1],
        ) *
          scale >
        1 + 1e-8
      )
        return "support-registration-mismatch";
      offsets.push([
        old.world[0] - travel[0] - source[0],
        old.world[1] - travel[1] - source[1],
      ]);
    }
    if (offsets.length) {
      translation = [
        offsets.reduce((sum, p) => sum + p[0], 0) / offsets.length,
        offsets.reduce((sum, p) => sum + p[1], 0) / offsets.length,
      ];
      if (
        offsets.some(
          (p) =>
            Math.hypot(p[0] - translation[0], p[1] - translation[1]) * scale >
            1 + 1e-8,
        )
      )
        return "support-conflict";
    }
    // A repeated whole cel closes against the first confirmed cycle, rather
    // than inheriting every small acquisition error from the previous cycle.
    // Keep each actually sampled whole-cel origin inside the support lifetime
    // (including a mid-cycle resume) so install rollback,
    // cancellation, clip changes and scale changes cannot reuse stale state.
    const cycleOrigins = sameClip ? (prior?.cycleOrigins ?? []) : [];
    const cycleOrigin = cycleOrigins.find((origin) =>
      sameCel(frame, origin.frame),
    );
    if (
      clip.loop &&
      clip.distancePerCycle !== undefined &&
      cycleOrigin &&
      direction &&
      sameCel(frame, cycleOrigin.frame)
    ) {
      const cycles = reference - cycleOrigin.reference;
      if (cycles >= 1 - 1e-8 && Math.abs(cycles - Math.round(cycles)) < 1e-8) {
        const confirmed =
          ((phase - cycleOrigin.phase) / TAU) * clip.distancePerCycle;
        if (
          Math.hypot(
            travel[0] - cycleOrigin.travel[0] - direction[0] * confirmed,
            travel[1] - cycleOrigin.travel[1] - direction[1] * confirmed,
          ) *
            scale >
          1e-6
        )
          return "invalid-support-motion";
        const advance = cycles * clip.distancePerCycle;
        const canonical: SequencePoint = [
          cycleOrigin.translation[0] +
            direction[0] * advance -
            (travel[0] - cycleOrigin.travel[0]),
          cycleOrigin.translation[1] +
            direction[1] * advance -
            (travel[1] - cycleOrigin.travel[1]),
        ];
        // Every retained material point must still meet the existing DIP cap.
        // Newly acquired supports are registered only after this check.
        if (
          offsets.some(
            (point) =>
              Math.hypot(point[0] - canonical[0], point[1] - canonical[1]) *
                scale >
              1 + 1e-8,
          )
        )
          return "support-conflict";
        translation = canonical;
      }
    }
    const points: SupportPlayback["points"] = {};
    for (const [name, point] of entries) {
      const source = project(point);
      points[name] = prior?.points[name] ?? {
        source,
        referenceTravel: [...referenceTravel],
        world: [
          travel[0] + source[0] + translation[0],
          travel[1] + source[1] + translation[1],
        ],
      };
    }
    return {
      translation,
      support: {
        clip: input.clip,
        actualClip,
        reference,
        referenceTravel,
        scale,
        travel: [...travel],
        phase,
        direction,
        points,
        ...(clip.loop && clip.distancePerCycle !== undefined
          ? {
              cycleOrigins: cycleOrigin
                ? cycleOrigins
                : [
                    ...cycleOrigins,
                    {
                      frame: structuredClone(frame),
                      reference,
                      phase,
                      travel: [...travel],
                      translation: [...translation],
                    },
                  ],
            }
          : {}),
      },
    };
  }

  sample(input: SequenceInput): SequenceSample | null {
    const prior = this.playback ? { ...this.playback } : null;
    let result = this.sampleNext(input);
    if (this.failure) {
      this.playback = prior;
      // A rejected selection freezes the actual cel; returning to the previous
      // request must not catch up its old wall clock or confirmed phase.
      if (prior) {
        prior.start = null;
        prior.lastTime = null;
        prior.offset = prior.position;
      }
      result = this.retainRejectedSupport(input, result);
    }
    return result;
  }

  /** Preflight failure can arrive after a previous motion RPC was acknowledged. */
  rejectMotionPlayback(
    input: SequenceInput,
    reason: SequenceFailure["reason"],
  ): SequenceSample | null {
    const result = this.reject(reason, input.clip);
    if (this.playback) {
      this.playback.start = null;
      this.playback.lastTime = null;
      this.playback.offset = this.playback.position;
    }
    return this.retainRejectedSupport(input, result);
  }

  /** Asset waits keep the already painted cel registered; no selection or clock advances. */
  holdMotionPlayback(input: SequenceInput): SequenceSample | null {
    if (input.supportRequired && !input.travel)
      return this.rejectMotionPlayback(input, "missing-confirmed-travel");
    if (
      input.supportRequired &&
      (!finitePoint(input.travel!) ||
        !Number.isFinite(input.worldScale ?? 1) ||
        (input.worldScale ?? 1) <= 0)
    )
      return this.rejectMotionPlayback(input, "invalid-support-motion");
    return this.registerRetainedSupport(
      input,
      this.last ? structuredClone(this.last) : null,
      this.support ?? this.rejectedSupport,
    );
  }

  private retainRejectedSupport(
    input: SequenceInput,
    result: SequenceSample | null,
  ): SequenceSample | null {
    const support = this.support ?? this.rejectedSupport;
    const retained = this.registerRetainedSupport(input, result, support);
    this.rejectedSupport = support;
    if (this.support?.clip !== input.clip) this.support = null;
    return retained;
  }

  private registerRetainedSupport(
    input: SequenceInput,
    result: SequenceSample | null,
    support: SupportPlayback | null,
  ): SequenceSample | null {
    // The host may already have acknowledged this displacement. Refusing a
    // bad new cel must still keep the last painted sole at its world point.
    if (
      result &&
      input.travel &&
      finitePoint(input.travel) &&
      support &&
      support.scale === (input.worldScale ?? 1)
    ) {
      const targets = Object.entries(support.points).map(([name, point]) => {
        const anchor = result!.anchors.supports[name as SupportName]!;
        return [
          point.world[0] - input.travel![0] - anchor[0],
          point.world[1] - input.travel![1] - anchor[1],
        ] as SequencePoint;
      });
      if (targets.length) {
        const offset: SequencePoint = [
          targets.reduce((sum, p) => sum + p[0], 0) / targets.length,
          targets.reduce((sum, p) => sum + p[1], 0) / targets.length,
        ];
        const shift = (point: SequencePoint): SequencePoint => [
          point[0] + offset[0],
          point[1] + offset[1],
        ];
        result.translation = shift(result.translation);
        result.anchors.grip = shift(result.anchors.grip);
        result.anchors.foot = shift(result.anchors.foot);
        result.anchors.head = [
          shift(result.anchors.head[0]),
          shift(result.anchors.head[1]),
        ];
        for (const map of [result.anchors.contacts, result.anchors.supports])
          for (const key of Object.keys(map))
            (map as Record<string, SequencePoint>)[key] = shift(
              (map as Record<string, SequencePoint>)[key],
            );
        this.last = structuredClone(result);
        delete this.last.motionFailure;
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
    if (isTransitionContainer(this.sequences, input.clip))
      return this.reject("transition-container", input.clip);
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
    const total = clip.frames
      .slice(run.begin, run.end)
      .reduce((sum, cel) => sum + cel.durationMs, 0);
    let position =
      clip.distancePerCycle !== undefined
        ? run.offset + (((input.phase ?? 0) - run.phaseOrigin) / TAU) * total
        : run.offset + (input.t - run.start) * 1000;
    this.progress = null;
    let completedBridge = false;
    if (run.transition && position >= total) {
      completedBridge = true;
      // The terminal painted cel is exactly the destination's first cel.
      run.clip = run.target;
      run.start = input.t;
      run.offset = 0;
      run.phaseOrigin = input.phase ?? 0;
      run.begin = 0;
      run.end = target.frames.length;
      delete run.transition;
      clip = target;
      position = 0;
    } else if (run.transition) {
      this.progress = {
        id: run.transition,
        progress: Math.max(0, position / total),
      };
    } else if (!clip.loop && position < total) {
      this.progress = {
        id: run.clip,
        progress: Math.max(0, position / total),
      };
    }
    run.position = clip.loop
      ? modulo(position, duration(clip))
      : Math.min(
          Math.max(position, 0),
          completedBridge ? duration(clip) : total,
        );
    let frameIndex = run.begin;
    let stageReference: number | undefined;
    if (clip.distanceAtFrame && !run.transition) {
      const stage = sampleDistanceStage(
        clip,
        run.distanceStage,
        input.t,
        input.phase!,
      );
      if (!stage) return this.reject("invalid-support-motion", input.clip);
      run.distanceStage = stage.state;
      frameIndex = stage.index;
      stageReference = stage.referenceDistance / clip.distancePerCycle!;
      run.position = clip.frames
        .slice(0, frameIndex)
        .reduce((n, cel) => n + cel.durationMs, 0);
      const id = `sequence-stage:${run.owner}:${run.clip}:${stage.state.cycle}:${frameIndex}`;
      this.progress = {
        id,
        progress: stage.progress,
        ...(input.travel
          ? {
              motionBudget: {
                epoch: id,
                remainingDIP: stage.remaining * (input.worldScale ?? 1),
                confirmedTravel: {
                  x: input.travel[0] * (input.worldScale ?? 1),
                  y: input.travel[1] * (input.worldScale ?? 1),
                },
              },
            }
          : {}),
      };
    } else {
      let remaining = run.position;
      while (
        frameIndex < run.end - 1 &&
        remaining >= clip.frames[frameIndex].durationMs
      ) {
        remaining -= clip.frames[frameIndex].durationMs;
        frameIndex++;
      }
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
    let support: SupportPlayback | null = null;
    if (input.supportRequired && !input.travel)
      return this.reject("missing-confirmed-travel", input.clip);
    if (
      input.supportRequired &&
      (!finitePoint(input.travel!) ||
        !Number.isFinite(input.worldScale ?? 1) ||
        (input.worldScale ?? 1) <= 0)
    )
      return this.reject("invalid-support-motion", input.clip);
    const release =
      input.releaseSupportAtExit &&
      !Object.keys(frame.supports ?? {}).length &&
      sameCel(frame, target.frames[0]) &&
      (completedBridge ||
        Boolean(run.transition && frameIndex === run.end - 1));
    if (
      input.travel &&
      (input.supportRequired || clip.distancePerCycle !== undefined) &&
      !release
    ) {
      if (offsets.length) return this.reject("anchor-conflict", input.clip);
      const frameStart = clip.frames
        .slice(0, frameIndex)
        .reduce((sum, cel) => sum + cel.durationMs, 0);
      const reference =
        stageReference ??
        Math.floor(position / duration(clip)) + frameStart / duration(clip);
      const result = this.supportTranslation(
        input,
        clip,
        run.clip,
        frame,
        reference,
        translation,
      );
      if (typeof result === "string") return this.reject(result, input.clip);
      translation = result.translation;
      support = result.support;
    }
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
    if (run.transition) sample.clipRange = [run.begin, run.end];
    if (target.distancePerCycle !== undefined)
      sample.distancePerCycle = target.distancePerCycle;
    if (this.progress) sample.transition = { ...this.progress };
    this.last = structuredClone(sample);
    this.support = support;
    this.rejectedSupport = null;
    return structuredClone(sample);
  }
}
