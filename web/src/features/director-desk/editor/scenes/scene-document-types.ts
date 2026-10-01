import type { Project, ProductionNote, Vec3 } from "../model.ts";
import type { ModelResource } from "../resources/project-resources.ts";
import type { MediaResource } from "../media/model.ts";

export interface SceneDocument {
  format: "director-desk";
  version: 3;
  name: string;
  activeSceneId: string;
  resources: ModelResource[];
  media?: MediaResource[];
  scenes: SceneEntry[];
}
export interface SceneEntry {
  id: string;
  name: string;
  state: SceneState;
  origin?: ContinuityOrigin;
}
export type SceneState = Pick<
  Project,
  | "duration"
  | "fps"
  | "aspect"
  | "room"
  | "entities"
  | "cuts"
  | "references"
  | "production"
  | "floors"
  | "zones"
  | "editorView"
  | "creationMode"
  | "referenceLabels"
  | "lighting"
>;

export interface EndingObject {
  key: string;
  entityId: string | null;
  memberIndex: number | null;
  name: string;
  kind: string;
  position: Vec3;
  forward: Vec3;
  action: string | null;
  enabled: boolean;
  bounds: { min: Vec3; max: Vec3 } | null;
}
export interface ContinuityOrigin {
  version: 1;
  sceneId: string;
  sceneName: string;
  sourceHash: string;
  frameIndex: number;
  time: number;
  fps: number;
  duration: number;
  state: SceneState;
  notes: ProductionNote[];
  objects: EndingObject[];
  cameraId: string;
}
