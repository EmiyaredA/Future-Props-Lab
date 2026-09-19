import type { VideoEditorClip } from "./types";

export type ChromaKey = Required<NonNullable<VideoEditorClip["chromaKey"]>>;

export type ChromaKeyField = keyof ChromaKey;

export const CHROMA_COLOR_PRESETS = ["#00ff00", "#0000ff"] as const;

export const defaultChromaKey: ChromaKey = {
  enabled: false,
  color: "#00ff00",
  similarity: 42,
  softness: 18,
  despill: 30,
};

export type NamedChromaPresetId =
  | "green-basic"
  | "blue-basic"
  | "green-high-tolerance"
  | "green-portrait";

export const NAMED_CHROMA_PRESETS: ReadonlyArray<{
  id: NamedChromaPresetId;
  label: string;
  values: ChromaKey;
}> = [
  {
    id: "green-basic",
    label: "绿幕基础",
    values: {
      enabled: true,
      color: "#00ff00",
      similarity: 42,
      softness: 18,
      despill: 30,
    },
  },
  {
    id: "blue-basic",
    label: "蓝幕基础",
    values: {
      enabled: true,
      color: "#0000ff",
      similarity: 42,
      softness: 18,
      despill: 30,
    },
  },
  {
    id: "green-high-tolerance",
    label: "高容差绿幕",
    values: {
      enabled: true,
      color: "#00ff00",
      similarity: 65,
      softness: 25,
      despill: 40,
    },
  },
  {
    id: "green-portrait",
    label: "人像绿幕",
    values: {
      enabled: true,
      color: "#00ff00",
      similarity: 38,
      softness: 22,
      despill: 55,
    },
  },
];

export function resolveChromaKey(
  clip: Pick<VideoEditorClip, "chromaKey">,
): ChromaKey {
  return { ...defaultChromaKey, ...clip.chromaKey };
}

export function mergeChromaKey(
  clip: Pick<VideoEditorClip, "chromaKey">,
  dirty: Partial<ChromaKey>,
): ChromaKey {
  return { ...resolveChromaKey(clip), ...dirty };
}
