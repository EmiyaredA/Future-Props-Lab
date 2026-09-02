import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Copy,
  Download,
  Eye,
  Image,
  ImageDown,
  Music,
  RefreshCw,
  Trash2,
  Video,
} from "lucide-react";
import { nodeLabel } from "./geometry";
import { visualAssetDownloadPath, type VisualCanvasNode } from "../api";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

type MediaNode = Exclude<VisualCanvasNode, { kind: "text" }>;

function previewSourceForNode(node: MediaNode) {
  if (node.asset_id) {
    return { assetId: node.asset_id, kind: node.kind, fallback: false };
  }
  if (node.kind === "image" && node.generation_draft?.reference_asset_id) {
    return {
      assetId: node.generation_draft.reference_asset_id,
      kind: "image" as const,
      fallback: true,
    };
  }
  if (node.kind === "video" && node.generation_draft) {
    const draft = node.generation_draft;
    const imageId =
      draft.first_frame_asset_id ??
      draft.reference_asset_ids?.[0] ??
      draft.last_frame_asset_id;
    if (imageId)
      return { assetId: imageId, kind: "image" as const, fallback: true };
    const videoId = draft.video_asset_ids?.[0];
    if (videoId)
      return { assetId: videoId, kind: "video" as const, fallback: true };
  }
  return { assetId: null, kind: node.kind, fallback: false };
}

export function CanvasMediaPreview({
  node,
  interactive = false,
  onVideoReadyChange,
}: {
  node: MediaNode;
  interactive?: boolean;
  onVideoReadyChange?: (video: HTMLVideoElement | null) => void;
}) {
  const preview = previewSourceForNode(node);
  const readyChangeRef = useRef(onVideoReadyChange);
  readyChangeRef.current = onVideoReadyChange;
  const { url, error } = useApiBlobUrl(
    preview.assetId ? `/v1/files/${preview.assetId}/content` : null,
  );
  const missing = Boolean(error);
  useEffect(
    () => () => {
      readyChangeRef.current?.(null);
    },
    [url],
  );

  if (url && preview.kind === "image")
    return (
      <img
        src={url}
        alt={preview.fallback ? "生成参考素材预览" : ""}
        draggable={false}
      />
    );
  if (url && preview.kind === "video")
    return (
      <video
        src={url}
        controls={interactive}
        data-canvas-media-interactive={interactive ? "true" : undefined}
        playsInline
        onClick={(event) => {
          if (interactive) event.stopPropagation();
        }}
        onLoadedData={(event) => readyChangeRef.current?.(event.currentTarget)}
        onEmptied={() => readyChangeRef.current?.(null)}
        onError={() => readyChangeRef.current?.(null)}
      />
    );
  if (url && preview.kind === "audio") return <audio src={url} controls />;
  const Icon =
    node.kind === "image" ? Image : node.kind === "video" ? Video : Music;
  return (
    <div className={`canvas-media-placeholder${missing ? " is-missing" : ""}`}>
      <Icon aria-hidden />
      <span>
        {missing ? "素材已删除" : `选择或上传${nodeLabel(node.kind)}`}
      </span>
    </div>
  );
}

export function CanvasMediaNodeActions({
  node,
  onReplace,
  onPreview,
  onCopy,
  onDelete,
  canExportFrame = false,
  onExportFrame,
}: {
  node: MediaNode;
  onReplace: () => void;
  onPreview?: () => void;
  onCopy: () => void;
  onDelete: () => void;
  canExportFrame?: boolean;
  onExportFrame?: () => void;
}) {
  const { url } = useApiBlobUrl(
    node.asset_id ? `/v1/files/${node.asset_id}/content` : null,
  );
  const stopPointer = (event: ReactPointerEvent) => event.stopPropagation();
  return (
    <span className="canvas-node-actions canvas-media-node-actions">
      {node.kind === "video" && onPreview ? (
        <button
          aria-label="播放视频"
          title="播放视频"
          disabled={!url}
          onPointerDown={stopPointer}
          onClick={(event) => {
            event.stopPropagation();
            onPreview();
          }}
        >
          <Eye aria-hidden />
        </button>
      ) : (
        <a
          aria-label="预览素材"
          aria-disabled={!url}
          href={url ?? undefined}
          target="_blank"
          rel="noreferrer"
          onPointerDown={stopPointer}
          onClick={(event) => event.stopPropagation()}
        >
          <Eye aria-hidden />
        </a>
      )}
      <button
        aria-label="替换素材"
        title="替换素材"
        onPointerDown={stopPointer}
        onClick={(event) => {
          event.stopPropagation();
          onReplace();
        }}
      >
        <RefreshCw aria-hidden />
      </button>
      <button
        aria-label="复制节点"
        title="复制节点"
        onPointerDown={stopPointer}
        onClick={(event) => {
          event.stopPropagation();
          onCopy();
        }}
      >
        <Copy aria-hidden />
      </button>
      {node.kind === "video" ? (
        <button
          aria-label="导出当前视频帧"
          title="导出当前视频帧"
          disabled={!canExportFrame}
          onPointerDown={stopPointer}
          onClick={(event) => {
            event.stopPropagation();
            onExportFrame?.();
          }}
        >
          <ImageDown aria-hidden />
        </button>
      ) : null}
      <a
        aria-label="下载素材"
        aria-disabled={!node.asset_id}
        href={
          node.asset_id
            ? visualAssetDownloadPath(node.asset_id, node.title)
            : undefined
        }
        onPointerDown={stopPointer}
        onClick={(event) => event.stopPropagation()}
      >
        <Download aria-hidden />
      </a>
      <button
        aria-label="删除节点"
        title="删除节点"
        onPointerDown={stopPointer}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 aria-hidden />
      </button>
    </span>
  );
}
