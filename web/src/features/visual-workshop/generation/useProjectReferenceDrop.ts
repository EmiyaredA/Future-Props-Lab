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

export type ReferenceDropNotice = {
  id: string;
  tone: "success" | "error";
  message: string;
};

function quoted(name: string) {
  return `「${name}」`;
}

/** Drops select an existing project file; draft owners keep persistence rules. */
export function useProjectReferenceDrop({
  projectId,
  files,
  selections,
  excludedAssetIds = [],
  onResult,
}: {
  projectId: string;
  files: ManagedFile[];
  selections: ReferenceSelection[];
  excludedAssetIds?: string[];
  onResult?: (notice: ReferenceDropNotice) => void;
}) {
  const [active, setActive] = useState(false);
  const [notice, setNotice] = useState<ReferenceDropNotice | null>(null);
  const publish = (tone: ReferenceDropNotice["tone"], message: string) => {
    const next = { id: crypto.randomUUID(), tone, message };
    setNotice(next);
    onResult?.(next);
  };
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
    if (!payload) {
      publish("error", "无法识别拖入的素材。");
      return;
    }
    if (excludedAssetIds.includes(payload.assetId)) {
      publish("error", "不能把当前节点自己的素材作为参考。");
      return;
    }
    const selection = selections.find(
      (item) => item.kind === payload.mediaKind,
    );
    if (!selection) {
      publish("error", "当前参考框不接受这种素材。");
      return;
    }
    if (selection.disabled) {
      publish("error", "这个参考框当前不可用。");
      return;
    }
    if (
      payload.importMode !== "none" ||
      (payload.sourceProjectId && payload.sourceProjectId !== projectId)
    ) {
      publish("error", "请先把素材导入当前项目，再拖入参考框。");
      return;
    }
    const file = files.find(
      (item) =>
        item.id === payload.assetId && item.media_kind === selection.kind,
    );
    if (!file) {
      publish("error", "素材还没准备好，或已不在当前项目中。");
      return;
    }
    const occupied = new Set([
      ...selection.value,
      ...(selection.linkedValue ?? []),
    ]);
    if (occupied.has(file.id)) {
      publish("error", `${quoted(file.display_name)}已经在参考框里。`);
      return;
    }
    if (
      selection.multiple
        ? occupied.size >= selection.max
        : (selection.linkedValue?.length ?? 0) > 0
    ) {
      publish(
        "error",
        selection.multiple
          ? "参考素材已达到数量上限。"
          : "这个位置已被连线素材占用。",
      );
      return;
    }
    const replacing = !selection.multiple && selection.value.length > 0;
    selection.onChange(
      selection.multiple ? [...new Set(selection.value), file.id] : [file.id],
    );
    publish(
      "success",
      replacing
        ? `已替换为${quoted(file.display_name)}。`
        : `已添加${quoted(file.display_name)}。`,
    );
  };
  return {
    active,
    notice,
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
