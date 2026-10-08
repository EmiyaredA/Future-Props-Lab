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
}: {
  projectId: string;
  files: ManagedFile[];
  selections: ReferenceSelection[];
}) {
  const [active, setActive] = useState(false);
  const [notice, setNotice] = useState("");
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
      setNotice("无法读取拖入的素材，请重新拖动。");
      return;
    }
    const selection = selections.find(
      (item) => item.kind === payload.mediaKind,
    );
    if (!selection || selection.disabled) {
      setNotice("当前参考框不支持此素材，请拖入对应类型的可用参考框。");
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
      setNotice(
        "素材尚未加载、已失效或不属于本项目，请先从素材选择菜单导入或重新选择。",
      );
      return;
    }
    const occupied = new Set([
      ...selection.value,
      ...(selection.linkedValue ?? []),
    ]);
    if (occupied.has(file.id)) {
      setNotice("此素材已在参考框中。");
      return;
    }
    if (
      selection.multiple
        ? occupied.size >= selection.max
        : (selection.linkedValue?.length ?? 0) > 0
    ) {
      setNotice(
        `当前参考框最多支持 ${selection.max} 个素材，请先移除已有参考。`,
      );
      return;
    }
    selection.onChange(
      selection.multiple ? [...new Set(selection.value), file.id] : [file.id],
    );
    setNotice(`已添加参考素材：${file.display_name}`);
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
