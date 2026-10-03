/** Private desktop coordinates are logical pixels (DIP), including negative display origins. */
export type PetRect = { x: number; y: number; width: number; height: number };
export type PetGeometry = {
  visible: PetRect;
  feet: { x: number; y: number };
};
export type PetEnvironment = {
  revision: number;
  generation: number;
  bounds: PetRect;
  displayId: number;
  workArea: PetRect;
  visible: boolean;
};
export type PetMotionFrame = {
  state: "idle" | "walk" | "climb" | "glide" | "land" | "held";
  facing: -1 | 1;
  edge: "left" | "right" | null;
  phase: number;
  velocity: { x: number; y: number };
  swing: number;
  grip?: { x: number; y: number };
  /** Host-confirmed cumulative DIP travel; never the unacknowledged target. */
  travel?: { x: number; y: number };
  stage?: "start" | "loop" | "end";
  progress?: number;
  strideLength?: number;
  contacts?: { feet: [boolean, boolean]; hands: [boolean, boolean] };
};
export type PetMotionRequest = {
  generation: number;
  sequence: number;
  environmentRevision: number;
  x: number;
  y: number;
  geometry: PetGeometry;
  manual: boolean;
};
