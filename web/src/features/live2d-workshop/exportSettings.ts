import type { CharacterDocument, ExportRequest } from "./types";
export type Crop = NonNullable<ExportRequest["crop"]>;
export type CropMode = "full" | "square" | "custom";
export function exportCrop(
  doc: CharacterDocument,
  mode: CropMode,
  custom: Crop,
): Crop {
  if (mode === "full")
    return { x: 0, y: 0, width: doc.width, height: doc.height };
  if (mode === "custom") return custom;
  const size = Math.min(doc.width, doc.height);
  return {
    x: (doc.width - size) / 2,
    y: (doc.height - size) / 2,
    width: size,
    height: size,
  };
}
export function defaultEnd(
  doc: CharacterDocument,
  motions: string[],
  fps: number,
) {
  const lengths = doc.motions
    .filter((m) => motions.includes(m.id))
    .map((m) => Math.max(1, Math.floor((m.duration / m.fps) * fps)));
  return lengths.length ? Math.min(...lengths) : 1;
}
export function outputSize(width: number, crop: Crop) {
  const ratio = crop.height / crop.width;
  const w = Math.max(
    32,
    Math.min(2048, Math.round(width), Math.floor(2048 / ratio)),
  );
  return {
    width: w,
    height: Math.max(32, Math.min(2048, Math.round(w * ratio))),
  };
}
