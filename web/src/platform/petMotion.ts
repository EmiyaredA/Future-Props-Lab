/** Private desktop coordinates are logical pixels (DIP), including negative display origins. */
export type PetRect = { x: number; y: number; width: number; height: number };
export type PetEdge = "left" | "right" | "top" | "bottom";
/** Read-only renderer feedback. Resource time advances independently of window motion. */
export type PetMotionBudget = {
  /** Changes on selection/cancellation and each committed distance stage. */
  epoch: string;
  /** Remaining authorized movement from this confirmed cumulative DIP travel. */
  remainingDIP: number;
  confirmedTravel: { x: number; y: number };
};
export type PetPosePlayback = {
  id: string;
  progress: number;
  motionBudget?: PetMotionBudget;
};
export type PetGeometry = {
  visible: PetRect;
  feet: { x: number; y: number };
  /** Authored support planes, independent of transparent window margins. */
  edges?: Record<PetEdge, { x: number; y: number }>;
  supportedEdges?: PetEdge[];
  strideLength?: number;
};
export type PetEnvironment = {
  revision: number;
  generation: number;
  bounds: PetRect;
  /** Confirmed canvas translation when native window placement is constrained (macOS menu bar). */
  sceneOffset?: { x: number; y: number };
  displayId: number;
  workArea: PetRect;
  visible: boolean;
};
/** Private read-only host receipt; generation is the confirmed environment's generation. */
export type PetMotionReceipt = {
  sequence: number;
  environment: PetEnvironment;
};
export const motionOrigin = (environment: PetEnvironment) => ({
  x: environment.bounds.x + (environment.sceneOffset?.x ?? 0),
  y: environment.bounds.y + (environment.sceneOffset?.y ?? 0),
});
export function unshiftGeometry(
  shape: PetGeometry,
  offset = { x: 0, y: 0 },
): PetGeometry {
  const point = (p: { x: number; y: number }) => ({
    x: p.x - offset.x,
    y: p.y - offset.y,
  });
  return {
    ...shape,
    visible: { ...shape.visible, ...point(shape.visible) },
    feet: point(shape.feet),
    edges: shape.edges
      ? (Object.fromEntries(
          Object.entries(shape.edges).map(([edge, p]) => [edge, point(p)]),
        ) as PetGeometry["edges"])
      : undefined,
  };
}
export type PetContactAnchor = Readonly<{
  /** Host-confirmed travel at touchdown; the renderer resolves the anatomical point in rig space. */
  travel: Readonly<{ x: number; y: number }>;
  phase: number;
  motion: "walk" | "climb";
  facing: -1 | 1;
  edge?: PetEdge | null;
}>;
export type PetMotionFrame = {
  state: "idle" | "walk" | "climb" | "glide" | "land" | "held";
  facing: -1 | 1;
  edge: PetEdge | null;
  attachment?: "settling" | "moving" | "resting" | "turning";
  edgeTurn?: { from: PetEdge; to: PetEdge; progress: number };
  phase: number;
  velocity: { x: number; y: number };
  swing: number;
  grip?: { x: number; y: number };
  /** Final host placement absorbs this renderer-local hold offset on release. */
  placementShift?: { x: number; y: number };
  /** Host-confirmed cumulative DIP travel; never the unacknowledged target. */
  travel?: { x: number; y: number };
  stage?: "start" | "loop" | "end";
  progress?: number;
  strideLength?: number;
  contacts?: { feet: [boolean, boolean]; hands: [boolean, boolean] };
  contactAnchors?: {
    feet: [PetContactAnchor | null, PetContactAnchor | null];
    hands: [PetContactAnchor | null, PetContactAnchor | null];
  };
};
export type PetMotionRequest = {
  generation: number;
  sequence: number;
  environmentRevision: number;
  x: number;
  y: number;
  geometry: PetGeometry;
  manual: boolean;
  grab?: { x: number; y: number };
};
