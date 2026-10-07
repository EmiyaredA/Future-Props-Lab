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
} from "@features/visual-workshop/api";

export type CanvasUploadNotice = {
  tone: "pending" | "error" | "success" | "info";
  message: string;
};

export function useCanvasUpload({
  projectId,
  prepareCanvas,
  applyServerCanvas,
  uploadPosition,
  setSelectedId,
  setInspectedNodeId,
  setMediaEditorTab,
}: {
  projectId: string;
  prepareCanvas: () => Promise<number>;
  applyServerCanvas: (document: VisualCanvasDocument) => void;
  uploadPosition: MutableRefObject<{ x: number; y: number }>;
  setSelectedId: (id: string | undefined) => void;
  setInspectedNodeId: (id: string | undefined) => void;
  setMediaEditorTab: (tab: "content" | "generate") => void;
}) {
  const client = useQueryClient();
  const [uploadNotice, setUploadNotice] = useState<CanvasUploadNotice | null>(
    null,
  );
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const created: ManagedFile[] = [];
      for (const [index, file] of files.entries()) {
        if (
          /^(image|audio|video)\//.test(file.type) ||
          /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|mkv|mp3|wav|m4a|ogg|aac|flac)$/i.test(
            file.name,
          )
        ) {
          const revision = await prepareCanvas();
          const updated = await uploadMaterialNode(projectId, file, revision, {
            x: uploadPosition.current.x + index * 28,
            y: uploadPosition.current.y + index * 28,
          });
          applyServerCanvas(updated);
          client.setQueryData(
            visualWorkshopQueryKeys.canvas(projectId),
            updated,
          );
          const node = updated.nodes.at(-1)!;
          setSelectedId(node.id);
          setInspectedNodeId(node.id);
          setMediaEditorTab("content");
        } else {
          created.push(await uploadManagedFile(file, projectId));
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
  return { upload, uploadNotice, setUploadNotice };
}
