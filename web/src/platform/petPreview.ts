import type { components } from "@generated/api";

export type PetPreviewIdentity = {
  projectId: string;
  sessionId: string;
  baseRevision: number;
};
export type PetPreviewDraft = PetPreviewIdentity & {
  sequence: number;
  config: Omit<components["schemas"]["PetConfig"], "persona">;
  skinId: string | null;
  eventName: "idle" | "click" | "pet" | "grab" | "drop" | "roam";
  mode: "inspect" | "event" | "runtime";
  key: number;
  line: number;
  motionDemo?:
    "held" | "climb-left" | "climb-right" | "glide-left" | "glide-right" | null;
};
export type PetPreviewStatus = {
  sessionId: string | null;
  state: "idle" | "active" | "paused" | "error";
  message: string;
};
export type PetPreviewDelivery = {
  draft: PetPreviewDraft;
  paused: boolean;
} | null;
