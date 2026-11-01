import type { Schemas } from "./modelSchema";
export type Point = Schemas["Point"];
export type Part = Omit<Required<Schemas["CharacterPart"]>, "skinWeights"> & {
  skinWeights?: Schemas["BoneWeight"][][] | null;
};
export type Deformer = Required<Schemas["CharacterDeformer"]>;
export type Bone = Required<Schemas["CharacterBone"]>;
export type Camera = Schemas["CharacterCamera"];
export type Keyform = Schemas["ParameterKeyform"];
export type Parameter = Required<Schemas["CharacterParameter"]>;
export type TimeKey = Required<Schemas["TimeKeyframe"]>;
export type Motion = Omit<Required<Schemas["CharacterMotion"]>, "tracks"> & {
  tracks: { parameterId: string; keys: TimeKey[] }[];
};
export type Expression = Required<Schemas["CharacterExpression"]>;
export type CharacterDocument = Omit<
  Required<Schemas["CharacterDocument"]>,
  | "parts"
  | "deformers"
  | "bones"
  | "parameters"
  | "motions"
  | "expressions"
  | "idleBehavior"
> & {
  idleBehavior: Required<Schemas["CharacterIdleBehavior"]> | null;
  parts: Part[];
  deformers: Deformer[];
  bones: Bone[];
  parameters: Parameter[];
  motions: Motion[];
  expressions: Expression[];
};
