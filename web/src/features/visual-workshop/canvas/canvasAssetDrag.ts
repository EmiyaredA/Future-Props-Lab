export const CANVAS_ASSET_DRAG_MIME = "application/x-fpl-canvas-asset";

export type CanvasAssetImportMode = "none" | "library" | "cross-project";

export type CanvasAssetDragPayload = {
  assetId: string;
  mediaKind: "image" | "video" | "audio";
  displayName: string;
  importMode: CanvasAssetImportMode;
  sourceProjectId?: string;
};

export function isCanvasMediaKind(
  kind: string,
): kind is CanvasAssetDragPayload["mediaKind"] {
  return kind === "image" || kind === "video" || kind === "audio";
}

export function setCanvasAssetDragData(
  dataTransfer: DataTransfer,
  payload: CanvasAssetDragPayload,
): void {
  dataTransfer.setData(CANVAS_ASSET_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "copy";
}

export function isCanvasAssetDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(CANVAS_ASSET_DRAG_MIME);
}

export function readCanvasAssetDragData(
  dataTransfer: DataTransfer,
): CanvasAssetDragPayload | null {
  const raw = dataTransfer.getData(CANVAS_ASSET_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasAssetDragPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const mediaKind = String(parsed.mediaKind ?? "");
    if (
      typeof parsed.assetId !== "string" ||
      !parsed.assetId ||
      !isCanvasMediaKind(mediaKind) ||
      typeof parsed.displayName !== "string" ||
      !parsed.displayName ||
      (parsed.importMode !== "none" &&
        parsed.importMode !== "library" &&
        parsed.importMode !== "cross-project")
    ) {
      return null;
    }
    return {
      assetId: parsed.assetId,
      mediaKind,
      displayName: parsed.displayName,
      importMode: parsed.importMode,
      sourceProjectId:
        typeof parsed.sourceProjectId === "string"
          ? parsed.sourceProjectId
          : undefined,
    };
  } catch {
    return null;
  }
}
