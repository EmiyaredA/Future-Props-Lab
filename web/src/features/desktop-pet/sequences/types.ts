import type { PetEdge } from "@platform/petMotion";

/** Source-local pixels. Atlas rect origin is never added to these anchors. */
export type SequencePoint = [number, number];
export type SequenceRect = [number, number, number, number];
export type SequenceFrame = {
  /** Validated texture ID; never a URL or file path. */
  texture: string;
  rect: SequenceRect;
  durationMs: number;
  grip: SequencePoint;
  foot: SequencePoint;
  head: [SequencePoint, SequencePoint];
  contacts?: Partial<Record<PetEdge, SequencePoint>>;
  supports?: Partial<
    Record<"armNear" | "armFar" | "legBack" | "legFront", SequencePoint>
  >;
};
export type SequenceClip = {
  frames: SequenceFrame[];
  loop: boolean;
  /** Model-space distance per complete cycle; renderer scales it to DIP. */
  distancePerCycle?: number;
};
/** A complete entry/exit/turn clip connecting two actual clip IDs. */
export type SequenceTransition = {
  id: string;
  from: string;
  to: string;
  clip: string;
};
export type FrameSequences = {
  version: 1;
  frameSize: SequencePoint;
  modelBox: SequenceRect;
  /** Model-space cranial reference; every cel must match within 2%. */
  headLength: number;
  clips: Record<string, SequenceClip>;
  transitions: SequenceTransition[];
};
export type SequenceInput = {
  clip: string;
  /** Renderer seconds; independent of window motion. */
  t: number;
  /** Confirmed locomotion radians, 2π per cycle. Required for distance clips. */
  phase?: number;
  /** Desired model-space anchors, before the caller's single actor scale. */
  grip?: SequencePoint;
  foot?: SequencePoint;
  /** Host-confirmed signed displacement, converted to model units by the renderer. */
  travel?: SequencePoint;
  /** Model-to-DIP scale; support tolerance is measured in DIP, never source pixels. */
  worldScale?: number;
  /** Unit signed motion direction when known (walk/horizontal edge); never inferred from phase alone. */
  direction?: SequencePoint;
  /** Actual physical entry/exit bridges also require registered world supports. */
  supportRequired?: boolean;
  /** Only the exact terminal airborne target cel may release departure supports. */
  releaseSupportAtExit?: boolean;
};
export type SequenceProgress = { id: string; progress: number };
export type SequenceFailure = {
  reason:
    | "missing-clip"
    | "missing-frame"
    | "invalid-frame"
    | "invalid-layout"
    | "head-scale-mismatch"
    | "invalid-time"
    | "missing-phase"
    | "anchor-conflict"
    | "missing-transition"
    | "transition-entry-mismatch"
    | "transition-exit-mismatch"
    | "missing-confirmed-travel"
    | "missing-distance-per-cycle"
    | "missing-support"
    | "support-registration-mismatch"
    | "support-handoff-missing"
    | "support-conflict"
    | "invalid-support-motion";
  clip?: string;
};
export type SequenceSample = {
  clip: string;
  requestedClip: string;
  frameIndex: number;
  frame: SequenceFrame;
  modelBox: SequenceRect;
  /** Uniform source-to-model scale; never fitted to individual cel bounds. */
  scale: number;
  distancePerCycle?: number;
  translation: SequencePoint;
  anchors: {
    grip: SequencePoint;
    foot: SequencePoint;
    head: [SequencePoint, SequencePoint];
    contacts: Partial<Record<PetEdge, SequencePoint>>;
    supports: Partial<
      Record<"armNear" | "armFar" | "legBack" | "legFront", SequencePoint>
    >;
  };
  transition?: SequenceProgress;
  motionFailure?: SequenceFailure;
};
