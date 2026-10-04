import type { PetMotionFrame, PetPosePlayback } from "@platform/petMotion";
import type { ArticulationFrame } from "../../locomotion/articulation";
export type WhaleFrame = ArticulationFrame & {
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
  groupTilt?(mode: string, tilt: number, lean: number): number;
  motionFacing?(motion: PetMotionFrame, seconds?: number): number;
  pickupPoint?(): number[] | null;
  getMotionFailure?(): string | null;
  getMotionTransition?(): PetPosePlayback | null;
  cancelMotionPlayback?(): void;
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
