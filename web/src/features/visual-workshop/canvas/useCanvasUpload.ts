import { useEffect, useState, type MutableRefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import { invalidateFileScope, uploadManagedFile } from "@features/files";
import {
  nextNodeId,
  type NodeKind,
} from "@features/visual-workshop/canvas/geometry";
import type { VisualCanvasNode } from "@features/visual-workshop/api";

export type CanvasUploadNotice = {
  tone: "pending" | "error" | "success" | "info";
  message: string;
};

export function useCanvasUpload({
  projectId,
  uploadPosition,
  replaceNodes,
  setSelectedId,
  setInspectedNodeId,
  setMediaEditorTab,
}: {
  projectId: string;
  uploadPosition: MutableRefObject<{ x: number; y: number }>;
  replaceNodes: (
    updater: (current: VisualCanvasNode[]) => VisualCanvasNode[],
    recordHistory?: boolean,
  ) => void;
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
      const created = [];
      for (const file of files)
        created.push(await uploadManagedFile(file, projectId));
      return created;
    },
    onMutate: () => {
      setUploadNotice({ tone: "pending", message: "正在上传…" });
    },
    onSuccess: (files) => {
      const media = files.filter((file) =>
        ["image", "video", "audio"].includes(file.media_kind),
      );
      void invalidateFileScope(client, projectId);
      if (!media.length) {
        setUploadNotice({
          tone: "info",
          message: files.length
            ? "已上传到项目素材，但该文件类型无法在画布上创建节点。"
            : "没有可上传的文件。",
        });
        return;
      }
      const createdNodes = media.map(
        (file, index) =>
          ({
            id: nextNodeId(file.media_kind as NodeKind),
            kind: file.media_kind,
            title: file.display_name,
            position: {
              x: uploadPosition.current.x + index * 28,
              y: uploadPosition.current.y + index * 28,
            },
            asset_id: file.id,
          }) as VisualCanvasNode,
      );
      replaceNodes((current) => [...current, ...createdNodes], true);
      const first = createdNodes[0];
      if (first) {
        setSelectedId(first.id);
        setInspectedNodeId(first.id);
        setMediaEditorTab("content");
      }
      setUploadNotice({
        tone: "success",
        message:
          media.length === 1
            ? "已上传并添加到画布"
            : `已上传 ${media.length} 个素材到画布`,
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
