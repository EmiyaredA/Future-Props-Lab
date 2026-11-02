import { useTransferProgress } from "@platform/api/useTransferProgress";
import { useEffect, useState, type MutableRefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { visualWorkshopQueryKeys } from "../queryKeys";
import { apiErrorMessage } from "@platform/api/errors";
import {
  invalidateFileScope,
  uploadManagedFile,
  type ManagedFile,
} from "@features/files";
import {
  uploadMaterialNode,
  type VisualCanvasDocument,
  type VisualCanvasNode,
  type MaterialUploadDestination,
} from "@features/visual-workshop/api";
import { batchInsertionAnchor, type CanvasPoint } from "./canvasPlacement";
import type { NodeKind } from "./geometry";

function fileKind(file: File): NodeKind | undefined {
  if (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(file.name)
  )
    return "image";
  if (
    file.type.startsWith("video/") ||
    /\.(mp4|webm|mov|mkv)$/i.test(file.name)
  )
    return "video";
  if (
    file.type.startsWith("audio/") ||
    /\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(file.name)
  )
    return "audio";
}

export type CanvasUploadNotice = {
  tone: "pending" | "error" | "success" | "info";
  message: string;
};

export function useCanvasUpload({
  projectId,
  prepareCanvas,
  applyServerCanvas,
  uploadPosition,
  getInsertionAnchor,
  resolveNodePosition,
  revealNodes,
  setSelectedId,
  setInspectedNodeId,
  setMediaEditorTab,
}: {
  projectId: string;
  prepareCanvas: () => Promise<number>;
  applyServerCanvas: (document: VisualCanvasDocument) => void;
  uploadPosition: MutableRefObject<CanvasPoint | undefined>;
  getInsertionAnchor: () => CanvasPoint;
  resolveNodePosition: (kind: NodeKind, anchor: CanvasPoint) => CanvasPoint;
  revealNodes: (nodes: VisualCanvasNode[]) => void;
  setSelectedId: (id: string | undefined) => void;
  setInspectedNodeId: (id: string | undefined) => void;
  setMediaEditorTab: (tab: "content" | "generate") => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const client = useQueryClient();
  const [uploadNotice, setUploadNotice] = useState<CanvasUploadNotice | null>(
    null,
  );
  const upload = useMutation({
    mutationFn: async (
      input: File[] | { files: File[]; destination: MaterialUploadDestination },
    ) => {
      const { files, destination } = Array.isArray(input)
        ? { files: input, destination: undefined }
        : input;
      const created: ManagedFile[] = [];
      const anchor = uploadPosition.current ?? getInsertionAnchor();
      const count = files.filter((file) => fileKind(file)).length;
      let index = 0;
      for (const file of files) {
        const kind = fileKind(file);
        if (kind) {
          const revision = await prepareCanvas();
          const position = resolveNodePosition(
            kind,
            batchInsertionAnchor(anchor, index++, count),
          );
          const updated = await runTransfer((onProgress) =>
            uploadMaterialNode(
              projectId,
              file,
              revision,
              position,
              destination,
              { onProgress },
            ),
          );
          applyServerCanvas(updated);
          client.setQueryData(
            visualWorkshopQueryKeys.canvas(projectId),
            updated,
          );
          const node = updated.nodes.at(-1)!;
          revealNodes([node]);
          setSelectedId(node.id);
          setInspectedNodeId(node.id);
          setMediaEditorTab("content");
        } else {
          created.push(
            await runTransfer((onProgress) =>
              uploadManagedFile(file, projectId, undefined, undefined, {
                onProgress,
              }),
            ),
          );
        }
      }
      return created;
    },
    onMutate: () => {
      setUploadNotice({ tone: "pending", message: "正在上传…" });
    },
    onSuccess: (files) => {
      void invalidateFileScope(client, projectId);
      setUploadNotice({
        tone: "success",
        message: files.length ? "文件已上传到项目素材" : "已上传并添加到画布",
      });
    },
    onError: (error) => {
      setUploadNotice({
        tone: "error",
        message: apiErrorMessage(error, "上传失败，请稍后重试。"),
      });
    },
  });
  useEffect(() => {
    if (!uploadNotice || uploadNotice.tone === "pending") return;
    if (uploadNotice.tone === "error") return;
    const timer = window.setTimeout(() => setUploadNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [uploadNotice]);
  return {
    transferProgress: activeTransferProgress,
    upload,
    uploadNotice,
    setUploadNotice,
  };
}
