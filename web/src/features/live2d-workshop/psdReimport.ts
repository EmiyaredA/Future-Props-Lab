import type { CharacterDocument } from "./types";

export type PsdLayerCandidate = {
  name: string;
  group: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const key = (name: string, group: string) => `${group}/${name}`;

export function planPsdReimport(
  doc: CharacterDocument,
  layers: PsdLayerCandidate[],
  canvas: { width: number; height: number },
) {
  const errors: string[] = [];
  const notices: string[] = [];
  const matches = new Map<number, string>();
  if (
    doc.parts.length &&
    (doc.width !== canvas.width || doc.height !== canvas.height)
  )
    errors.push(
      `画布尺寸从 ${doc.width} × ${doc.height} 变为 ${canvas.width} × ${canvas.height}，可能破坏已有绑定`,
    );
  const existing = new Map<string, string>();
  for (const part of doc.parts) {
    const path = key(part.name, part.group);
    if (existing.has(path)) errors.push(`工程中存在重复图层路径：${path}`);
    existing.set(path, part.id);
  }
  const seen = new Set<string>();
  for (const [index, layer] of layers.entries()) {
    const path = key(layer.name, layer.group);
    if (seen.has(path)) errors.push(`PSD 中存在重复图层路径：${path}`);
    seen.add(path);
    const partId = existing.get(path);
    if (!partId) continue;
    const part = doc.parts.find((item) => item.id === partId)!;
    if (
      part.width !== layer.width ||
      part.height !== layer.height ||
      part.x !== layer.x ||
      part.y !== layer.y
    )
      errors.push(`${path}：尺寸或位置变化，需作为新部件导入并重新绑定`);
    else matches.set(index, partId);
  }
  const additions = layers.length - matches.size;
  if (doc.parts.length + additions > 128)
    errors.push("导入后将超过 128 个部件");
  if (matches.size)
    notices.push(
      `${matches.size} 个同名图层将替换原始 PNG，并保留网格与参数绑定`,
    );
  if (additions) notices.push(`${additions} 个新图层将加入工程`);
  const missing = doc.parts.filter(
    (part) => !seen.has(key(part.name, part.group)),
  );
  if (matches.size && missing.length)
    notices.push(`${missing.length} 个原有图层不在 PSD 中，仍保留在工程`);
  return { errors, notices, matches, additions };
}

export async function pngDimensions(
  file: Blob,
): Promise<{ width: number; height: number }> {
  const data = new DataView(await file.slice(0, 24).arrayBuffer());
  if (
    data.byteLength < 24 ||
    data.getUint32(0) !== 0x89504e47 ||
    data.getUint32(4) !== 0x0d0a1a0a
  )
    throw new Error("图层不是有效 PNG");
  return { width: data.getUint32(16), height: data.getUint32(20) };
}
