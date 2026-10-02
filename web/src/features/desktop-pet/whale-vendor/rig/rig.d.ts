export type RigPart = {
  id: string;
  tex: string;
  box: number[];
  grid: number[];
  parent: string;
  z: number;
};
export type Deformer = {
  kind: "rot" | "warp";
  pivot?: number[];
  rect?: number[];
  parent?: string;
};
export type DeformerState = {
  a?: number;
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  fn?: (u: number, v: number) => number[];
};
export type RigState = Record<string, DeformerState | Record<string, number>>;
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
};
