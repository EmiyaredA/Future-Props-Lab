import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import {
  FilePlus2,
  Image,
  Library,
  Music2,
  Trash2,
  Type,
  Upload,
  Video,
} from "lucide-react";
import {
  deleteVideoEditorAsset,
  importVideoEditorAssets,
  listVideoEditorImportSources,
  uploadVideoEditorAsset,
} from "./api";
import type { VideoEditorAsset } from "./types";
import { videoEditorQueryKeys } from "./queryKeys";

const iconFor = (kind: string) =>
  kind === "video"
    ? Video
    : kind === "audio"
      ? Music2
      : kind === "image"
        ? Image
        : Type;

export function VideoEditorAssetPanel({
  projectId,
  assets,
  onAdd,
  onAddGenerated,
}: {
  projectId: string;
  assets: VideoEditorAsset[];
  onAdd: (asset: VideoEditorAsset) => void;
  onAddGenerated: (kind: "text" | "color") => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const [showImport, setShowImport] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<VideoEditorAsset>();
  const [deleteError, setDeleteError] = useState("");
  const sources = useQuery({
    queryKey: videoEditorQueryKeys.importSources,
    queryFn: listVideoEditorImportSources,
    enabled: showImport,
  });
  const refresh = () =>
    void client.invalidateQueries({
      queryKey: videoEditorQueryKeys.assets(projectId),
    });
  const upload = useMutation({
    mutationFn: (file: File) => uploadVideoEditorAsset(projectId, file),
    onSuccess: refresh,
  });
  const importAssets = useMutation({
    mutationFn: () => importVideoEditorAssets(projectId, chosen),
    onSuccess: () => {
      setChosen([]);
      setShowImport(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (assetId: string) => deleteVideoEditorAsset(projectId, assetId),
    onSuccess: () => {
      setDeleting(undefined);
      setDeleteError("");
      refresh();
    },
    onError: (error) => {
      setDeleteError(apiErrorMessage(error, "素材删除失败，请稍后重试。"));
    },
  });
  const requestDelete = (asset: VideoEditorAsset) => {
    setDeleteError("");
    setDeleting(asset);
  };
  return (
    <aside className="ve-assets-panel">
      <header>
        <strong>素材</strong>
        <span>{assets.length}</span>
      </header>
      <div className="ve-asset-actions">
        <button onClick={() => input.current?.click()}>
          <Upload aria-hidden /> 上传
        </button>
        <button onClick={() => setShowImport(true)}>
          <Library aria-hidden /> 导入快照
        </button>
        <input
          ref={input}
          hidden
          type="file"
          accept="video/*,audio/*,image/*,.ttf,.otf,.woff,.woff2"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload.mutate(file);
            event.target.value = "";
          }}
        />
      </div>
      <div className="ve-generated-assets">
        <button onClick={() => onAddGenerated("text")}>
          <Type aria-hidden /> 文字卡
        </button>
        <button onClick={() => onAddGenerated("color")}>
          <span className="ve-black-swatch" /> 纯色黑幕
        </button>
      </div>
      <div className="ve-assets-list">
        {assets.map((asset) => {
          const Icon = iconFor(asset.mediaKind);
          const ready = asset.processingStatus === "ready";
          const processing = ["queued", "processing"].includes(
            asset.processingStatus,
          );
          return (
            <div
              key={asset.id}
              className="ve-asset"
              draggable={ready}
              onDragStart={(event) =>
                event.dataTransfer.setData(
                  "application/x-video-editor-asset",
                  asset.id,
                )
              }
            >
              <button
                type="button"
                className="ve-asset-main"
                disabled={!ready}
                aria-label={`双击将“${asset.displayName}”添加到时间轴`}
                onDoubleClick={() => onAdd(asset)}
              >
                {asset.thumbnailUrl ? (
                  <img src={asset.thumbnailUrl} alt="" />
                ) : (
                  <span>
                    <Icon aria-hidden />
                  </span>
                )}
                <span className="ve-asset-copy">
                  <strong>{asset.displayName}</strong>
                  <small>
                    {ready ? asset.mediaKind : asset.processingStatus}
                  </small>
                </span>
              </button>
              <div className="ve-asset-controls">
                <button
                  type="button"
                  disabled={!ready}
                  aria-label={`将“${asset.displayName}”添加到时间轴`}
                  title="添加到时间轴"
                  onClick={() => onAdd(asset)}
                >
                  <FilePlus2 aria-hidden />
                </button>
                <button
                  type="button"
                  className="ve-asset-delete"
                  disabled={processing}
                  aria-label={`删除素材“${asset.displayName}”`}
                  title={processing ? "素材处理中，完成后可删除" : "删除素材"}
                  onClick={() => requestDelete(asset)}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {showImport ? (
        <div className="ve-dialog-backdrop">
          <section
            className="ve-dialog ve-import-dialog"
            role="dialog"
            aria-modal="true"
          >
            <h2>从其他应用复制素材</h2>
            <p>导入后生成独立物理快照，源项目删除也不会影响剪辑。</p>
            <div>
              {(sources.data?.items ?? []).map((asset) => (
                <button
                  key={asset.id}
                  className={chosen.includes(asset.id) ? "selected" : ""}
                  onClick={() =>
                    setChosen((items) =>
                      items.includes(asset.id)
                        ? items.filter((id) => id !== asset.id)
                        : [...items, asset.id],
                    )
                  }
                >
                  <span>{chosen.includes(asset.id) ? "✓" : ""}</span>
                  <div>
                    <strong>{asset.displayName}</strong>
                    <small>{asset.sourceApplication}</small>
                  </div>
                </button>
              ))}
            </div>
            <footer>
              <button onClick={() => setShowImport(false)}>取消</button>
              <button
                className="primary"
                disabled={!chosen.length}
                onClick={() => importAssets.mutate()}
              >
                复制 {chosen.length || ""} 项
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={deleting ? `删除“${deleting.displayName}”？` : "删除素材？"}
        description={
          <>
            <span>删除后将清理该项目中的源文件，且无法撤销。</span>
            {deleteError ? (
              <strong className="ve-asset-delete-error" role="alert">
                {deleteError}
              </strong>
            ) : null}
          </>
        }
        confirmLabel="确认删除"
        pending={remove.isPending}
        onCancel={() => {
          setDeleting(undefined);
          setDeleteError("");
        }}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </aside>
  );
}
