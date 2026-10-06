import type {
  FrameSequences,
  SequenceFailure,
  SequenceFrame,
  SequenceSample,
  SequenceTransition,
} from "./types";

/** A painted bridge endpoint may start the destination's next transition immediately. */
export function transitionSourceForSample(
  sequences: FrameSequences,
  sample: SequenceSample,
): { clip: string; frameIndex: number } {
  const target = sequences.clips[sample.requestedClip];
  if (
    sample.clipRange &&
    sample.frameIndex === sample.clipRange[1] - 1 &&
    target?.frames[0] &&
    sameSequenceCel(sample.frame, target.frames[0]) &&
    sequences.transitions.some(
      (link) =>
        link.to === sample.requestedClip &&
        (link.clip === sample.clip ||
          link.branches?.some((branch) => branch.clip === sample.clip)),
    )
  )
    return { clip: sample.requestedClip, frameIndex: 0 };
  return { clip: sample.clip, frameIndex: sample.frameIndex };
}

/** Strict painted identity: a metadata registration cannot replace an actual cel. */
export function sameSequenceCel(a: SequenceFrame, b: SequenceFrame): boolean {
  const anchors = (value: SequenceFrame) =>
    ["contacts", "supports"].map((key) =>
      Object.entries(value[key as "contacts" | "supports"] ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, point]) => [name, ...point]),
    );
  return (
    a.texture === b.texture &&
    JSON.stringify([a.rect, a.grip, a.foot, a.head, anchors(a)]) ===
      JSON.stringify([b.rect, b.grip, b.foot, b.head, anchors(b)])
  );
}

/** A declared branch set is complete or unusable; never fall back to its flat clip. */
export function transitionBranchFailure(
  sequences: FrameSequences,
  transition: SequenceTransition,
): SequenceFailure["reason"] | null {
  if (transition.branches === undefined) return null;
  const source = sequences.clips[transition.from];
  const target = sequences.clips[transition.to];
  if (!source || !target) return "missing-clip";
  if (
    !Array.isArray(transition.branches) ||
    transition.branches.length !== source.frames.length
  )
    return "missing-transition-branch";
  const indices = new Set<number>();
  for (const branch of transition.branches) {
    if (
      !Number.isInteger(branch.fromFrame) ||
      branch.fromFrame < 0 ||
      branch.fromFrame >= source.frames.length ||
      indices.has(branch.fromFrame)
    )
      return "missing-transition-branch";
    indices.add(branch.fromFrame);
    const bridge = sequences.clips[branch.clip];
    if (!bridge) return "missing-clip";
    if (bridge.loop || bridge.distancePerCycle !== undefined)
      return "invalid-frame";
    if (!bridge.frames.length || !target.frames.length) return "missing-frame";
    const segment = transitionSegmentForFrame(
      sequences,
      transition,
      branch.fromFrame,
    );
    if (!segment) return "invalid-frame";
    if (
      !sameSequenceCel(
        bridge.frames[segment.start],
        source.frames[branch.fromFrame],
      )
    )
      return "transition-entry-mismatch";
    if (!sameSequenceCel(bridge.frames[segment.end - 1], target.frames[0]))
      return "transition-exit-mismatch";
  }
  return null;
}

export type SequenceSegment = { clip: string; start: number; end: number };

/** One shared resolver for validation, capability, decode and actual-cel playback. */
export function transitionSegmentForFrame(
  sequences: FrameSequences,
  transition: SequenceTransition,
  fromFrame: number,
): SequenceSegment | null {
  const branch = transition.branches?.find(
    (item) => item.fromFrame === fromFrame,
  );
  const clip =
    transition.branches === undefined ? transition.clip : branch?.clip;
  if (!clip || !sequences.clips[clip]) return null;
  const length = sequences.clips[clip].frames.length;
  if (branch && "range" in branch) {
    const range = branch.range;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !range.every(Number.isInteger) ||
      range[0] < 0 ||
      range[1] > length ||
      range[1] - range[0] < 2
    )
      return null;
    return { clip, start: range[0], end: range[1] };
  }
  return { clip, start: 0, end: length };
}

/** A partial-range timeline is a container, never an actor action to play in full. */
export function isTransitionContainer(
  sequences: FrameSequences,
  clip: string,
): boolean {
  const length = sequences.clips[clip]?.frames.length;
  return sequences.transitions.some((transition) =>
    transition.branches?.some(
      (branch) =>
        branch.clip === clip &&
        Array.isArray(branch.range) &&
        branch.range.length === 2 &&
        (branch.range[0] !== 0 || branch.range[1] !== length),
    ),
  );
}
