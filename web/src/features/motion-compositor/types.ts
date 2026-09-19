import type { components } from "@generated/api";

export type MotionProject = components["schemas"]["ProjectOut"];
export type MotionDocumentOut = components["schemas"]["DocumentOut"];
export type MotionComposition = components["schemas"]["MotionComposition"];
export type MotionLayer = components["schemas"]["MotionLayer"];
export type MotionAsset = components["schemas"]["AssetOut"];
export type MotionKeyframe = components["schemas"]["MotionKeyframe"];
export type MotionMask = components["schemas"]["MotionMask"];
export type MotionOperation = components["schemas"]["MotionOperation"];
export type MotionExport = components["schemas"]["ExportOut"];
export type MotionFormat = "mp4" | "mov4444" | "png-sequence";

export type ResolvedDocument = MotionComposition & {
  settings: components["schemas"]["MotionSettings"];
  layers: MotionLayer[];
};

export function resolvedDocument(
  document: MotionComposition,
): ResolvedDocument {
  return document as ResolvedDocument;
}
