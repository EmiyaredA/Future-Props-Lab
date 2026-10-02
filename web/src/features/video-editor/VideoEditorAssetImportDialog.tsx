import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { Image, Music2, Type, Video } from "lucide-react";
import type { components } from "@generated/api";

type AvailableAsset = components["schemas"]["VideoEditorAvailableAssetOut"];

function ImportSourcePreview({ asset }: { asset: AvailableAsset }) {
  const previewable =
    asset.mediaKind === "image" || asset.mediaKind === "video";
  const { url } = useApiBlobUrl(
    previewable ? `/v1/files/${encodeURIComponent(asset.id)}/content` : null,
  );
  const Icon =
    asset.mediaKind === "video"
      ? Video
      : asset.mediaKind === "audio"
        ? Music2
        : asset.mediaKind === "image"
          ? Image
          : Type;

  if (url && asset.mediaKind === "image") {
    return <img className="ve-import-preview" src={url} alt="" />;
  }
  if (url && asset.mediaKind === "video") {
    return (
      <video
        className="ve-import-preview"
        src={url}
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  return (
    <span className="ve-import-preview ve-import-preview-fallback">
      <Icon aria-hidden />
    </span>
  );
}

export function VideoEditorAssetImportDialog({
  items,
  chosen,
  pending,
  onToggle,
  onCancel,
  onConfirm,
}: {
  items: AvailableAsset[];
  chosen: string[];
  pending?: boolean;
  onToggle: (assetId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="ve-dialog-backdrop">
      <section
        className="ve-dialog ve-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ve-import-dialog-title"
      >
        <h2 id="ve-import-dialog-title">从其他应用复制素材</h2>
        <p>导入后生成独立物理快照，源项目删除也不会影响剪辑。</p>
        <div className="ve-import-list">
          {items.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className={chosen.includes(asset.id) ? "selected" : ""}
              onClick={() => onToggle(asset.id)}
            >
              <span aria-hidden>{chosen.includes(asset.id) ? "✓" : ""}</span>
              <ImportSourcePreview asset={asset} />
              <div>
                <strong>{asset.displayName}</strong>
                <small>{asset.sourceApplication}</small>
              </div>
            </button>
          ))}
          {!items.length ? (
            <p className="ve-import-empty">暂无可导入的素材</p>
          ) : null}
        </div>
        <footer>
          <button type="button" onClick={onCancel} disabled={pending}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!chosen.length || pending}
            onClick={onConfirm}
          >
            {pending ? "复制中…" : `复制 ${chosen.length || ""} 项`}
          </button>
        </footer>
      </section>
    </div>
  );
}
