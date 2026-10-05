import type { PetHitRegion } from "../interaction";

/** Private renderer viewport; centerX is an in-place camera pivot, not a movement limit. */
export interface PetViewportBounds {
  W: number;
  H: number;
  floorY: number;
  S: number;
  centerX?: number;
}

export interface WhaleController {
  /** Available only with a real DIP viewportOrigin callback and a drawn frame. */
  beginPlacementHandoff(token: number): boolean;
  commitPlacementHandoff(token: number): boolean;
  cancelPlacementHandoff(): boolean;
  placementDelta(): { x: number; y: number };
  setLocomotion(
    value: import("@platform/petMotion").PetMotionFrame | null,
  ): void;
  hitPet(point: { x: number; y: number }): boolean;
  classifyHit(point: { x: number; y: number }): PetHitRegion | undefined;
  pointerMove(point: { x: number; y: number }): string;
  pointerLeave(): void;
  act(name: string): boolean;
  replaceReaction(
    motion: string | null,
    expression: string | null,
    holdExpression?: boolean,
  ): void;
  replaceRejectedReaction(
    motion: string | null,
    expression: string | null,
    holdExpression: boolean,
    code: string,
  ): void;
  getReactionFailure(): string | null;
  setExpr(name: string, seconds?: number): void;
  step(seconds: number): void;
  render(): void;
  resize(): void;
}
export function createPet(
  elements: { petG: SVGGElement; shadowEl: SVGElement; fxG: SVGGElement },
  options: Record<string, unknown>,
): WhaleController;
