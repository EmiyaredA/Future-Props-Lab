import type { components } from "@generated/api";
type S = components["schemas"];
export type Point = S["Point"];
export type Part = Required<S["CharacterPart"]>;
export type Deformer = Required<S["CharacterDeformer"]>;
export type Keyform = S["ParameterKeyform"];
export type Parameter = Required<S["CharacterParameter"]>;
export type TimeKey = Required<S["TimeKeyframe"]>;
export type Motion = Omit<Required<S["CharacterMotion"]>, "tracks"> & {
  tracks: { parameterId: string; keys: TimeKey[] }[];
};
export type Expression = Required<S["CharacterExpression"]>;
export type CharacterDocument = Omit<
  Required<S["CharacterDocument"]>,
  "parts" | "deformers" | "parameters" | "motions" | "expressions"
> & {
  parts: Part[];
  deformers: Deformer[];
  parameters: Parameter[];
  motions: Motion[];
  expressions: Expression[];
};
export type Asset = S["Live2DAssetOut"];
export type Project = S["Live2DProjectOut"];
export type ExportRequest = S["Live2DExportIn"];
export type ExportTask = S["Live2DExportOut"];
export type Mode = "model" | "rig" | "animation" | "export";
