import { useEffect, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateFileScope, type ManagedFile } from "@features/files";
import { apiErrorMessage } from "@platform/api/errors";
import { projectCardsKey, listProjectCards } from "../creative/api";
import { resolveDesignImage } from "../creative/cardMedia";
import {
  isCanvasAssetDrag,
  readCanvasAssetDragData,
} from "../canvas/canvasAssetDrag";
import {
  useReferenceUploads,
  type RegisterReferenceImage,
  type DesignReference,
} from "./useReferenceUploads";

type Media = "image" | "video" | "audio";
type ReferenceSelection = {
  kind: Media;
  value: string[];
  linkedValue?: string[];
  multiple?: boolean;
  max: number;
  disabled?: boolean;
  onChange: (ids: string[], design?: DesignReference) => void;
};
export type ReferenceDropNotice = {
  id: string;
  tone: "success" | "error" | "pending";
  message: string;
};

/** Only project members may be selected; uploads register images before binding. */
export function useProjectReferenceDrop({
  projectId,
  targetKey,
  files,
  selections,
  registerImage,
  excludedAssetIds = [],
  onFilesLoaded,
  onResult,
}: {
  projectId: string;
  targetKey?: string;
  files: ManagedFile[];
  selections: ReferenceSelection[];
  registerImage?: RegisterReferenceImage;
  excludedAssetIds?: string[];
  onFilesLoaded?: (files: ManagedFile[]) => void;
  onResult?: (notice: ReferenceDropNotice) => void;
}) {
  const client = useQueryClient();
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ReferenceDropNotice | null>(null);
  const busy = useRef(false);
  const session = useRef({ cancelled: false });
  useEffect(() => {
    const current = { cancelled: false };
    session.current = current;
    setPending(false);
    return () => {
      current.cancelled = true;
    };
  }, [projectId, targetKey]);
  const latest = useRef({ selections, excludedAssetIds, onFilesLoaded });
  useEffect(() => {
    latest.current = { selections, excludedAssetIds, onFilesLoaded };
  });
  const publish = (tone: ReferenceDropNotice["tone"], message: string) => {
    const next = { id: crypto.randomUUID(), tone, message };
    setNotice(next);
    onResult?.(next);
  };
  const selectionFor = (kind?: Media, id?: string) => {
    const selection = latest.current.selections.find(
      (item) => item.kind === kind,
    );
    if (!selection) throw new Error("当前参考框不接受这种素材。");
    if (selection.disabled) throw new Error("这个参考框当前不可用。");
    const occupied = new Set([
      ...selection.value,
      ...(selection.linkedValue ?? []),
    ]);
    if (id && occupied.has(id))
      throw new Error(
        `「${files.find((file) => file.id === id)?.display_name ?? "素材"}」已经在参考框里。`,
      );
    if (
      selection.multiple
        ? occupied.size >= selection.max
        : (selection.linkedValue?.length ?? 0) > 0
    )
      throw new Error(
        selection.multiple
          ? "参考素材已达到数量上限。"
          : "这个位置已被连线素材占用。",
      );
    if (selection.max <= 0) throw new Error("当前模型不支持这种参考素材。");
    return selection;
  };
  const select = (
    file: Pick<ManagedFile, "id" | "media_kind" | "display_name">,
    design?: DesignReference,
  ) => {
    if (!["image", "video", "audio"].includes(file.media_kind))
      throw new Error("当前参考框不接受这种素材。");
    if (latest.current.excludedAssetIds.includes(file.id))
      throw new Error("不能把当前节点自己的素材作为参考。");
    const selection = selectionFor(file.media_kind as Media, file.id);
    const next = selection.multiple
      ? [...new Set(selection.value), file.id]
      : [file.id];
    if (design) selection.onChange(next, design);
    else selection.onChange(next);
    latest.current = {
      ...latest.current,
      selections: latest.current.selections.map((item) =>
        item === selection ? { ...item, value: next } : item,
      ),
    };
    return !selection.multiple && selection.value.length
      ? `已替换为「${file.display_name}」。`
      : `已添加「${file.display_name}」。`;
  };
  const uploads = useReferenceUploads({
    projectId,
    targetKey,
    registerImage,
    validate: (kind) => {
      selectionFor(kind);
    },
    onResult: publish,
    onUploaded: (file, design) => {
      latest.current.onFilesLoaded?.([file]);
      select(file, design);
    },
  });
  const accepts = (data: DataTransfer) =>
    isCanvasAssetDrag(data) || Array.from(data.types).includes("Files");
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!accepts(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const enabled =
      !busy.current &&
      !uploads.pending &&
      selections.some((item) => !item.disabled && item.max > 0);
    event.dataTransfer.dropEffect = enabled ? "copy" : "none";
    setActive(enabled);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!accepts(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setActive(false);
    if (busy.current || uploads.pending) return;
    if (!isCanvasAssetDrag(event.dataTransfer)) {
      if (!selections.some((item) => !item.disabled && item.max > 0)) {
        publish("error", "这个参考框当前不可用。");
        return;
      }
      void uploads.uploadFiles([...(event.dataTransfer.files ?? [])]);
      return;
    }
    const payload = readCanvasAssetDragData(event.dataTransfer);
    if (!payload) {
      publish("error", "无法识别拖入的素材。");
      return;
    }
    if (!payload.cardId) {
      try {
        if (latest.current.excludedAssetIds.includes(payload.assetId))
          throw new Error("不能把当前节点自己的素材作为参考。");
        const selection = latest.current.selections.find(
          (item) => item.kind === payload.mediaKind,
        );
        if (!selection) throw new Error("当前参考框不接受这种素材。");
        if (selection.disabled) throw new Error("这个参考框当前不可用。");
        if (
          payload.importMode !== "none" ||
          (payload.sourceProjectId && payload.sourceProjectId !== projectId)
        )
          throw new Error("请先把素材导入当前项目，再拖入参考框。");
        const file = files.find(
          (item) =>
            item.id === payload.assetId &&
            item.media_kind === payload.mediaKind,
        );
        if (!file) throw new Error("素材还没准备好，或已不在当前项目中。");
        publish("success", select(file));
      } catch (error) {
        publish("error", apiErrorMessage(error));
      }
      return;
    }
    const current = session.current;
    busy.current = true;
    setPending(true);
    void (async () => {
      try {
        selectionFor("image");
        const cards = await client.fetchQuery({
          queryKey: projectCardsKey(projectId),
          queryFn: ({ signal }) => listProjectCards(projectId, signal),
          staleTime: 0,
        });
        if (current.cancelled) return;
        const card = cards.find(
          (item) => item.id === payload.cardId && !item.archived,
        );
        if (!card) throw new Error("请先将此设定卡收录到当前项目");
        const id = await resolveDesignImage(client, projectId, card);
        if (current.cancelled) return;
        publish(
          "success",
          select(
            { id, media_kind: "image", display_name: card.title },
            {
              asset_id: id,
              card_id: card.id,
              card_revision: card.revision,
              title: card.title,
            },
          ),
        );
        void invalidateFileScope(client, projectId);
      } catch (error) {
        if (!current.cancelled) publish("error", apiErrorMessage(error));
      } finally {
        busy.current = false;
        if (!current.cancelled) setPending(false);
      }
    })();
  };
  return {
    active,
    pending: pending || uploads.pending,
    notice,
    progress: uploads.progress,
    uploadFiles: uploads.uploadFiles,
    dialogs: uploads.dialogs,
    feedback: uploads.feedback,
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
