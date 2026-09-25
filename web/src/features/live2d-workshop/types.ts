import type { components } from "@generated/api";
type S = components["schemas"];
export type {
  Point,
  Part,
  Deformer,
  Bone,
  Camera,
  Keyform,
  Parameter,
  TimeKey,
  Motion,
  Expression,
  CharacterDocument,
} from "@shared/live2d/types";
export type Asset = S["Live2DAssetOut"];
export type Project = S["Live2DProjectOut"];
export type ExportRequest = S["Live2DExportIn"];
export type ExportTask = S["Live2DExportOut"];
export type Mode = "model" | "rig" | "animation" | "export";
