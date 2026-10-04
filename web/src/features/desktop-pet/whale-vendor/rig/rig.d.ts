import type { MeshGeometry } from "./meshGeometry.js";

export type RigPart = {
  id: string;
  tex: string;
  box: number[];
  grid: number[];
  parent: string;
  z: number;
  uvBox?: number[];
  /** Static source-art registration, applied once before articulated movement. */
  restTransform?: { angle: number; pivot: [number, number] };
  skin?: { deformer: string; weights: number[] }[];
  /** Frontend-compiled mesh; package schema and original texture remain unchanged. */
  mesh?: MeshGeometry;
};
export type Deformer = {
  kind: "rot" | "warp";
  pivot?: number[];
  rect?: number[];
  parent?: string;
};
export type DeformerState = {
  pivot?: number[];
  a?: number;
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  fn?: (u: number, v: number) => number[];
};
export type RigState = Record<
  string,
  DeformerState | Record<string, number>
> & {
  alpha: Record<string, number>;
  z?: Record<string, number>;
};
export function createRig(
  canvas: HTMLCanvasElement,
  model: {
    deformers: Record<string, Deformer>;
    parts: RigPart[];
    view: number[];
  },
): {
  gl: WebGL2RenderingContext;
  upload(key: string, source: TexImageSource): void;
  render(state: RigState): void;
  point(deformer: string, state: RigState, x: number, y: number): number[];
};
