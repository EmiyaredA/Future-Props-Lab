import type { PetMotionFrame, PetPosePlayback } from "@platform/petMotion";
import type { ArticulationFrame } from "../../locomotion/articulation";
import type { PetHitRegion } from "../../interaction";
export type WhaleFrame = ArticulationFrame & {
  /** Registered model-space pickup, latched for one hold; not the eased clicked point. */
  heldPickupPoint?: [number, number] | null;
  face?: string;
  look: number[];
  legs: number[][];
  low?: number;
  blink?: number;
  eyeClose?: number;
  talk?: number;
  tilt?: number;
  lean?: number;
};
export type WhaleFaceState = {
  eyes: {
    shape: string;
    rx?: number;
    ry?: number;
    dx?: number;
    dy?: number;
    s?: number;
    rot?: number;
  }[];
  gap: number[];
  brows?: string;
  blush?: number;
};
export interface WhaleFigure {
  fixedScale?: boolean;
  /** Current painted model pixel; null delegates visible base artwork to legacy hit geometry. */
  hitTest?(point: { x: number; y: number }): boolean | null;
  /** Current painted head/body or authoritative miss; undefined only for unsupported base artwork. */
  classifyHit?(point: { x: number; y: number }): PetHitRegion | undefined;
  /** Fixed painted model/world basis (only ±1); omitted keeps legacy turn squash. */
  groupFacing?(): number;
  groupTilt?(mode: string, tilt: number, lean: number): number;
  motionFacing?(motion: PetMotionFrame, seconds?: number): number;
  pickupPoint?(): number[] | null;
  /** Actual image load/decode/bounds error, distinct from pose capability failures. */
  getAssetFailure?(): string | null;
  /** Explicit user selection may retry an image failure; ordinary ticks/cancel may not. */
  retryAssetLoad?(): void;
  getMotionFailure?(): string | null;
  getMotionTransition?(): PetPosePlayback | null;
  cancelMotionPlayback?(): void;
  /** Retain the current painted reaction; physical playback remains independent. */
  rejectReactionPlayback?(code: string): void;
  acceptReactionPlayback?(): void;
  /** Retire hidden GPU/face surfaces without discarding accepted configuration. */
  releaseRenderSurface?(): void;
  dispose?(): void;
  setScheme(id: string, options?: { fade?: number }): Promise<void> | void;
}
export interface LoadedWhaleFigure extends WhaleFigure {
  fixedScale: boolean;
  motionFacing(motion: PetMotionFrame, seconds?: number): number;
  draw(group: SVGGElement, face: WhaleFaceState, frame: WhaleFrame): void;
  reset(): void;
  preload(): Promise<unknown>;
  readonly scheme: string;
}
export function createWhaleFigure(
  base: URL | undefined,
  options: {
    model: Record<string, unknown>;
    asset: (path: string) => string;
    scheme?: string;
    raster?: boolean;
  },
): Promise<LoadedWhaleFigure>;
