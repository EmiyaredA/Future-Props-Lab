import { strFromU8, unzipSync } from "fflate";
import { AMADEUS_PACKAGE_URL } from "@shared/live2d/bundled";
import type { CharacterDocument } from "@shared/live2d/types";
import type { AvatarState } from "./protocol";

export const avatarStates: AvatarState[] = [
  "idle",
  "listening",
  "thinking",
  "tool",
  "success",
  "error",
  "paused",
];

export type BundledAvatar = {
  document: CharacterDocument;
  urls: Map<string, string>;
};

const cache = new Map<string, Promise<BundledAvatar>>();

export function loadCharacterModel(url: string): Promise<BundledAvatar> {
  const existing = cache.get(url);
  if (existing) return existing;
  const loading = (async () => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Amadeus 模型文件无法读取");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const manifestFile = files["manifest.json"];
    if (!manifestFile) throw new Error("Amadeus 模型缺少清单");
    const manifest = JSON.parse(strFromU8(manifestFile)) as {
      format?: string;
      version?: number;
      document?: CharacterDocument;
    };
    if (
      manifest.format !== "fpllive2d" ||
      ![2, 3].includes(manifest.version ?? -1) ||
      !manifest.document
    )
      throw new Error("Amadeus 模型格式无效");
    const document = manifest.document;
    if (
      document.parts.length === 0 ||
      document.parts.length > 128 ||
      !avatarStates.every((state) => {
        const binding = document.stateBindings[state];
        return (
          binding?.motionId &&
          binding.expressionId &&
          document.motions.some((motion) => motion.id === binding.motionId) &&
          document.expressions.some(
            (expression) => expression.id === binding.expressionId,
          )
        );
      })
    )
      throw new Error("Amadeus 模型状态绑定不完整");
    const urls = new Map<string, string>();
    try {
      for (const assetId of new Set(
        document.parts.map((part) => part.assetId),
      )) {
        const bytes = files[`assets/${assetId}.png`];
        if (!bytes) throw new Error(`Amadeus 模型素材缺失：${assetId}`);
        urls.set(
          assetId,
          URL.createObjectURL(
            new Blob([Uint8Array.from(bytes)], { type: "image/png" }),
          ),
        );
      }
    } catch (error) {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      throw error;
    }
    return { document, urls };
  })().catch((error) => {
    cache.delete(url);
    throw error;
  });
  cache.set(url, loading);
  return loading;
}

export const loadAmadeusModel = () => loadCharacterModel(AMADEUS_PACKAGE_URL);

export function boundPose(document: CharacterDocument, state: AvatarState) {
  const binding = document.stateBindings[state];
  const motion = document.motions.find((item) => item.id === binding.motionId);
  if (!motion || !binding.expressionId)
    throw new Error(`Amadeus 状态无效：${state}`);
  return { motion, expressionId: binding.expressionId };
}
