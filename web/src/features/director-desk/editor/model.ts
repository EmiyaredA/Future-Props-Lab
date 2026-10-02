import type { JointName } from "./assets/joint-schema.ts";
import type { PropParameters } from "./parametric-props.ts";
import type {
  ModelResource,
  ExternalModel,
} from "./resources/project-resources.ts";
import type { NativeAnimation } from "./resources/native-animation.ts";
import type { RetargetAnimation } from "./resources/retarget-animation.ts";
import type { ContactAnchor } from "./assets/contact-anchors.ts";
import type { HandBinding } from "./animation/hand-binding.ts";
import type { StructureLink } from "./building/structure-links.ts";
import type { Floor, EditorView } from "./building/floors.ts";
import type { InitialPose } from "./scenes/initial-pose.ts";
import type { CameraLookPath } from "./animation/camera-look.ts";
import type { SceneZone } from "./building/zones.ts";
import type { Easing } from "./animation/channels.ts";
import type { CameraEffects } from "./cinematography/camera-effects-types.ts";
import type { CameraAimResponse } from "./cinematography/aim-response.ts";
import type { LightConfig, LightingConfig } from "./lighting/model.ts";
import type { WarpConfig } from "./visuals/warps.ts";
import type {
  VisualConfig,
  FieldConfig,
  DeformConfig,
} from "./visuals/model.ts";
import type { MediaResource, SurfaceAppearance } from "./media/model.ts";
export type Vec3 = [number, number, number];
export type Kind = "actor" | "prop" | "camera" | "crowd";
export type Action =
  | "idle"
  | "walk"
  | "run"
  | "sit"
  | "standup"
  | "crouch"
  | "crawl"
  | "jump"
  | "lie"
  | "fall"
  | "wave"
  | "point"
  | "turn";
export type Joint = JointName;
export type Pose = Partial<Record<Joint, number>>;
export interface Waypoint {
  stop?: boolean;
  easing?: Easing;
  time: number;
  position: Vec3;
}
export interface MotionPath {
  interpolation?: "continuous";
  smooth: boolean;
  points: Waypoint[];
  sections?: { start: number; end: number; from: number; to: number }[];
}
export interface Clip {
  id: string;
  name?: string;
  start: number;
  end: number;
  action: Action | "native" | "retarget";
  native?: NativeAnimation;
  retarget?: RetargetAnimation;
  speed: number;
  offset?: number;
  progressOffset?: number;
  sourceDuration?: number;
  turnAmount?: number;
}
export interface PoseKey {
  time: number;
  pose: Pose;
}
export interface CameraConfig {
  aimResponse?: CameraAimResponse;
  effects?: CameraEffects;
  targetPath?: CameraLookPath | null;
  aim: "target" | "manual";
  focal: number;
  target: Vec3;
  targetId: string;
  targetHeight: number;
  mode: "free" | "follow" | "pov";
  offset: Vec3;
  inheritRotation: boolean;
  hideWalls: string[];
  hiddenEntityIds?: string[];
}
export interface Entity {
  surface?: SurfaceAppearance | null;
  visual?: VisualConfig;
  warp?: WarpConfig;
  field?: FieldConfig;
  deform?: DeformConfig | null;
  light?: LightConfig;
  initialPose?: InitialPose;
  floorId?: string;
  structureLink?: StructureLink | null;
  handBinding?: HandBinding | null;
  contactAnchors?: ContactAnchor[];
  external?: ExternalModel;
  id: string;
  kind: Kind;
  name: string;
  asset: string;
  color: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
  height: number;
  build: "slim" | "normal" | "broad";
  gender: "male" | "female";
  path: MotionPath | null;
  face: "path" | "fixed" | "target";
  faceTarget: string;
  clips: Clip[];
  pose: Pose;
  poseKeys: PoseKey[];
  camera: CameraConfig | null;
  count: number;
  spacing: number;
  seed: number;
  reference: string;
  parameters?: Partial<PropParameters>;
  assetParameters?: Record<string, number>;
  actionBlend?: number;
  footContact?: boolean;
}
export interface Cut {
  time: number;
  cameraId: string;
}
export interface ReferenceImage {
  id: string;
  name: string;
  data: string;
}
export interface ProductionNote {
  id: string;
  start: number;
  end: number;
  actorId: string;
  story: string;
  emotion: string;
  dialogue: string;
  action: string;
}
export interface ProductionData {
  fixedPrompt: string;
  sceneReferenceIds: string[];
  notes: ProductionNote[];
  promptText?: string;
}
export interface Project {
  media?: MediaResource[];
  lighting?: LightingConfig;
  creationMode?: "full" | "geometry";
  referenceLabels?: boolean;
  zones?: SceneZone[];
  floors?: Floor[];
  editorView?: EditorView;
  format: "director-desk";
  version: 1 | 2;
  resources?: ModelResource[];
  name: string;
  duration: number;
  fps: number;
  aspect: string;
  room: {
    enabled: boolean;
    width: number;
    depth: number;
    height: number;
  };
  entities: Entity[];
  cuts: Cut[];
  references: ReferenceImage[];
  production?: ProductionData;
}
export {
  ASPECTS,
  FRAME_RATES,
  ACTIONS,
  JOINTS,
  COLORS,
  uid,
  clone,
  aspectNumber,
  outputSize,
  getFrameCount,
} from "./model-constants.ts";
export { clipLabel, entity, clip, demoProject } from "./model-creation.ts";
export { assertProject, validateProject } from "./model-validation.ts";
