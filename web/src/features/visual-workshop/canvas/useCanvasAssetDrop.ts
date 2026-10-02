import { useCallback, useRef, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import {
  importFile,
  importManagedFiles,
  invalidateFileScope,
} from "@features/files";
import type { VisualCanvasNode } from "@features/visual-workshop/api";
import {
  isCanvasAssetDrag,
  readCanvasAssetDragData,
  type CanvasAssetDragPayload,
} from "./canvasAssetDrag";
import type { CanvasUploadNotice } from "./useCanvasUpload";

export function useCanvasAssetDrop({
  projectId,
  screenToWorld,
  createMediaNodeFromAsset,
  setUploadNotice,
}: {
  projectId: string;
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  createMediaNodeFromAsset: (
    asset: {
      id: string;
      media_kind: "image" | "video" | "audio";
      display_name: string;
    },
    position: { x: number; y: number },
  ) => VisualCanvasNode;
  setUploadNotice: (notice: CanvasUploadNotice | null) => void;
}) {
  const client = useQueryClient();
  const dropping = useRef(false);

  const onAssetDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isCanvasAssetDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const ensureInProject = useCallback(
    async (payload: CanvasAssetDragPayload) => {
      if (payload.importMode === "none") {
        return {
          id: payload.assetId,
          media_kind: payload.mediaKind,
          display_name: payload.displayName,
        };
      }
      if (payload.importMode === "library") {
        await importFile(projectId, payload.assetId);
        return {
          id: payload.assetId,
          media_kind: payload.mediaKind,
          display_name: payload.displayName,
        };
      }
      const sourceProjectId = payload.sourceProjectId;
      if (!sourceProjectId) {
        throw new Error("无法确定跨项目素材的来源项目");
      }
      const imported = await importManagedFiles(projectId, {
        sourceScope: "project",
        sourceProjectId,
        assetIds: [payload.assetId],
      });
      const asset = imported.items[0];
      if (!asset) throw new Error("跨项目导入未返回素材");
      return {
        id: asset.id,
        media_kind: payload.mediaKind,
        display_name: asset.display_name || payload.displayName,
      };
    },
    [projectId],
  );

  const onAssetDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      if (!isCanvasAssetDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      const payload = readCanvasAssetDragData(event.dataTransfer);
      if (!payload) return;
      if (dropping.current) return;
      dropping.current = true;
      const position = screenToWorld(event.clientX, event.clientY);
      const needsImport = payload.importMode !== "none";
      if (needsImport) {
        setUploadNotice({
          tone: "pending",
          message: "正在导入并添加到画布…",
        });
      }
      try {
        const asset = await ensureInProject(payload);
        await invalidateFileScope(client, projectId);
        createMediaNodeFromAsset(asset, position);
        setUploadNotice({
          tone: "success",
          message: needsImport ? "已导入并添加到画布" : "已添加到画布",
        });
      } catch (error) {
        setUploadNotice({
          tone: "error",
          message: apiErrorMessage(error, "添加到画布失败，请稍后重试。"),
        });
      } finally {
        dropping.current = false;
      }
    },
    [
      client,
      createMediaNodeFromAsset,
      ensureInProject,
      projectId,
      screenToWorld,
      setUploadNotice,
    ],
  );

  return { onAssetDragOver, onAssetDrop };
}
