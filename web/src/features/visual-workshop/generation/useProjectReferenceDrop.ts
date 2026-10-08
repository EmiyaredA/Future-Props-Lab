import { useState, type DragEvent } from "react";
import type { ManagedFile } from "@features/files";
import {
  isCanvasAssetDrag,
  readCanvasAssetDragData,
} from "../canvas/canvasAssetDrag";

type ReferenceSelection = {
  kind: "image" | "video" | "audio";
  value: string[];
  linkedValue?: string[];
  multiple?: boolean;
  max: number;
  disabled?: boolean;
  onChange: (ids: string[]) => void;
};

/** Drops select an existing project file; draft owners keep persistence rules. */
export function useProjectReferenceDrop({
  projectId,
  files,
  selections,
  excludedAssetIds = [],
}: {
  projectId: string;
  files: ManagedFile[];
  selections: ReferenceSelection[];
  excludedAssetIds?: string[];
}) {
  const [active, setActive] = useState(false);
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!isCanvasAssetDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const enabled = selections.some((selection) => !selection.disabled);
    event.dataTransfer.dropEffect = enabled ? "copy" : "none";
    setActive(enabled);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!isCanvasAssetDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setActive(false);
    const payload = readCanvasAssetDragData(event.dataTransfer);
    if (!payload || excludedAssetIds.includes(payload.assetId)) return;
    const selection = selections.find(
      (item) => item.kind === payload.mediaKind,
    );
    if (!selection || selection.disabled) {
      return;
    }
    const file = files.find(
      (item) =>
        item.id === payload.assetId && item.media_kind === selection.kind,
    );
    if (
      payload.importMode !== "none" ||
      (payload.sourceProjectId && payload.sourceProjectId !== projectId) ||
      !file
    ) {
      return;
    }
    const occupied = new Set([
      ...selection.value,
      ...(selection.linkedValue ?? []),
    ]);
    if (occupied.has(file.id)) {
      return;
    }
    if (
      selection.multiple
        ? occupied.size >= selection.max
        : (selection.linkedValue?.length ?? 0) > 0
    ) {
      return;
    }
    selection.onChange(
      selection.multiple ? [...new Set(selection.value), file.id] : [file.id],
    );
  };
  return {
    active,
    handlers: {
      onDragOver,
      onDrop,
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setActive(false);
      },
      onDragEnd: () => setActive(false),
    },
  };
}
