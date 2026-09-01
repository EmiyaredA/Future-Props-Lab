import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Copy,
  Download,
  Eye,
  Image,
  Music,
  RefreshCw,
  Trash2,
  Video,
} from "lucide-react";
import { nodeLabel } from "./geometry";
import type { VisualCanvasNode } from "../api";
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

export function CanvasMediaPreview({ node }: { node: MediaNode }) {
  const preview = previewSourceForNode(node);
  const { url, error } = useApiBlobUrl(
    preview.assetId ? `/v1/files/${preview.assetId}/content` : null,
  );
  const missing = Boolean(error);

  if (url && preview.kind === "image")
    return (
      <img
        src={url}
        alt={preview.fallback ? "生成参考素材预览" : ""}
        draggable={false}
      />
    );
  if (url && preview.kind === "video") return <video src={url} controls />;
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
  onCopy,
  onDelete,
}: {
  node: MediaNode;
  onReplace: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { url } = useApiBlobUrl(
    node.asset_id ? `/v1/files/${node.asset_id}/content` : null,
  );
  const stopPointer = (event: ReactPointerEvent) => event.stopPropagation();
  return (
    <span className="canvas-node-actions canvas-media-node-actions">
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
      <a
        aria-label="下载素材"
        aria-disabled={!url}
        download={node.title}
        href={url ?? undefined}
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
