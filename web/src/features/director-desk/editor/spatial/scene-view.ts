import type { Group, PerspectiveCamera } from "three";
import type { Project, Entity } from "../model.ts";
import type { Rig } from "../assets/human-legacy.ts";
import type { SceneModels } from "../resources/scene-models.ts";

/** Read-only surface needed by spatial queries; the editor engine may be replaced independently. */
export interface SpatialSceneView {
  project: Project;
  time: number;
  models: Map<string, Group>;
  rigs: Map<string, Rig>;
  cameras: Map<string, PerspectiveCamera>;
  crowdRigs: Map<string, Rig[]>;
  walls: Map<string, Group>;
  roomGroup: Group;
  externalModels: SceneModels;
  cameraEntity(id?: string): Entity;
  getShotCamera(id?: string): PerspectiveCamera;
}
