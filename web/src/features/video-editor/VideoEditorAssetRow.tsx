import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import {
  canEditAsset,
  assetPreparationLabel,
  assetUnavailableReason,
} from "./assetReadiness";
import { useState, type DragEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  LoaderCircle,
  FilePlus2,
  FolderInput,
  Image,
  Music2,
  Pencil,
  Trash2,
  Type,
  Video,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { fetchApiDownload } from "@platform/api/client";
import { apiErrorMessage } from "@platform/api/errors";
import { downloadProjectSnapshot } from "@shared/ui/project-library/downloadProjectSnapshot";
import type { VideoEditorAsset, VideoEditorAssetOrganization } from "./types";
import { VideoEditorAssetRenameDialog } from "./VideoEditorAssetRenameDialog";
import {
  type CompleteAssetOrganization,
  moveAssetInOrganization,
  shiftAssetInOrganization,
} from "./assetOrganization";

const iconFor = (kind: string) =>
  kind === "video"
    ? Video
    : kind === "audio"
      ? Music2
      : kind === "image"
        ? Image
        : Type;

export function VideoEditorAssetRow({
  projectId,
  asset,
  folderId,
  arranged,
  batchActive,
  selected,
  previewing = false,
  disabled,
  organizeOpen,
  onSelect,
  onPreview,
  onAdd,
  onDelete,
  onToggleOrganize,
  onCloseOrganize,
  onOrganizationChange,
  onTimelineAssetDrag,
  onDragOver,
  onDrop,
  organizeType,
  timelineType,
}: {
  projectId: string;
  asset: VideoEditorAsset;
  folderId: string | null;
  arranged: CompleteAssetOrganization;
  batchActive: boolean;
  selected: boolean;
  previewing?: boolean;
  disabled?: boolean;
  organizeOpen: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onAdd: () => void;
  onDelete: () => void;
  onToggleOrganize: () => void;
  onCloseOrganize: () => void;
  onOrganizationChange: (next: VideoEditorAssetOrganization) => Promise<void>;
  onTimelineAssetDrag?: (asset?: VideoEditorAsset) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  organizeType: string;
  timelineType: string;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [renaming, setRenaming] = useState(false);
  const download = useMutation({
    mutationFn: async () => {
      const file = await runTransfer((onProgress) =>
        fetchApiDownload(`/v1/files/${encodeURIComponent(asset.id)}/download`, {
          onProgress,
        }),
      );
      downloadProjectSnapshot(
        file,
        asset.originalFilename.replace(/[\\/]/g, "_"),
      );
    },
  });
  const Icon = iconFor(asset.mediaKind);
  const ready = canEditAsset(asset);
  const processing = ["queued", "processing"].includes(asset.processingStatus);
  const list = folderId
    ? (arranged.folders.find((folder) => folder.id === folderId)?.assetIds ??
      [])
    : arranged.rootAssetIds;
  const index = list.indexOf(asset.id);
  return (
    <div
      className={`ve-asset-wrap${previewing ? " is-previewing" : ""}`}
      title={ready ? undefined : assetUnavailableReason(asset)}
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData(organizeType, asset.id);
        event.dataTransfer.setData(timelineType, asset.id);
        onTimelineAssetDrag?.(asset);
      }}
      onDragEnd={() => onTimelineAssetDrag?.()}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <TransferFeedback progress={activeTransferProgress} />

      <div className="ve-asset">
        {batchActive ? (
          <label className="ve-asset-check">
            <input
              type="checkbox"
              checked={selected}
              aria-label={`选择素材“${asset.displayName}”`}
              onChange={onSelect}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="ve-asset-main"
          disabled={!ready || disabled}
          aria-label={`预览素材“${asset.displayName}”，双击添加到时间轴`}
          aria-pressed={previewing}
          onClick={onPreview}
          onDoubleClick={onAdd}
        >
          {asset.thumbnailUrl ? (
            <ResponsiveImage src={asset.thumbnailUrl} alt="" />
          ) : (
            <span>
              <Icon aria-hidden />
            </span>
          )}
          <span className="ve-asset-copy">
            <strong>{asset.displayName}</strong>
            <small>{assetPreparationLabel(asset)}</small>
          </span>
        </button>
        <div className="ve-asset-controls">
          <button
            type="button"
            className="ve-asset-rename"
            disabled={disabled}
            aria-label={`重命名素材“${asset.displayName}”`}
            title="重命名"
            onClick={() => {
              onCloseOrganize();
              setRenaming(true);
            }}
          >
            <Pencil aria-hidden />
            <span>重命名</span>
          </button>
          <button
            type="button"
            disabled={!ready || disabled}
            aria-label={`将“${asset.displayName}”添加到时间轴`}
            title={ready ? "添加到时间轴" : assetUnavailableReason(asset)}
            onClick={onAdd}
          >
            <FilePlus2 aria-hidden />
          </button>
          <button
            type="button"
            disabled={disabled}
            aria-expanded={organizeOpen}
            aria-label={`整理素材“${asset.displayName}”`}
            title="整理素材"
            onClick={onToggleOrganize}
          >
            <FolderInput aria-hidden />
          </button>
          <button
            type="button"
            disabled={download.isPending}
            aria-label={`下载素材“${asset.displayName}”`}
            aria-busy={download.isPending}
            title={download.isPending ? "正在下载…" : "下载原素材"}
            onClick={() => download.mutate()}
          >
            {download.isPending ? (
              <LoaderCircle className="ve-asset-download-pending" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
          </button>
          <button
            type="button"
            className="ve-asset-delete"
            disabled={processing || disabled}
            aria-label={`删除素材“${asset.displayName}”`}
            title={processing ? "素材处理中，完成后可删除" : "删除素材"}
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </button>
        </div>
      </div>
      {download.isError ? (
        <p className="ve-asset-download-error" role="alert">
          {apiErrorMessage(download.error, "下载失败，请重试")}
        </p>
      ) : null}
      {organizeOpen ? (
        <div className="ve-asset-organize-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => setRenaming(true)}
          >
            <Pencil aria-hidden /> 重命名
          </button>
          <div>
            <button
              role="menuitem"
              disabled={index === 0}
              onClick={() => {
                void onOrganizationChange(
                  shiftAssetInOrganization(arranged, asset.id, -1),
                );
                onCloseOrganize();
              }}
            >
              <ArrowUp aria-hidden /> 上移
            </button>
            <button
              role="menuitem"
              disabled={index === list.length - 1}
              onClick={() => {
                void onOrganizationChange(
                  shiftAssetInOrganization(arranged, asset.id, 1),
                );
                onCloseOrganize();
              }}
            >
              <ArrowDown aria-hidden /> 下移
            </button>
          </div>
          <strong>移动到</strong>
          <button
            role="menuitem"
            disabled={folderId === null}
            onClick={() => {
              void onOrganizationChange(
                moveAssetInOrganization(arranged, asset.id, null),
              );
              onCloseOrganize();
            }}
          >
            未分类
          </button>
          {arranged.folders.map((folder) => (
            <button
              key={folder.id}
              role="menuitem"
              disabled={folder.id === folderId}
              onClick={() => {
                void onOrganizationChange(
                  moveAssetInOrganization(arranged, asset.id, folder.id),
                );
                onCloseOrganize();
              }}
            >
              {folder.name}
            </button>
          ))}
        </div>
      ) : null}
      {renaming ? (
        <VideoEditorAssetRenameDialog
          projectId={projectId}
          asset={asset}
          disabled={disabled}
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </div>
  );
}
