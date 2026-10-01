export interface WhaleController {
  hitPet(point: { x: number; y: number }): boolean;
  pointerMove(point: { x: number; y: number }): string;
  pointerLeave(): void;
  act(name: string): boolean;
  setExpr(name: string, seconds?: number): void;
  step(seconds: number): void;
  render(): void;
  resize(): void;
}
export function createPet(
  elements: { petG: SVGGElement; shadowEl: SVGElement; fxG: SVGGElement },
  options: Record<string, unknown>,
): WhaleController;
