import type { VideoEditorAsset } from "./types";

export function canEditAsset(asset: VideoEditorAsset) {
  if (asset.processingStatus === "ready") return true;
  const durationUs = Number(asset.probe?.durationUs);
  return (
    asset.processingStatus === "processing" &&
    ["video", "audio"].includes(asset.mediaKind) &&
    Number.isFinite(durationUs) &&
    durationUs > 0
  );
}

export function assetPreparationLabel(asset: VideoEditorAsset) {
  if (asset.processingStatus === "ready")
    return (
      (
        { video: "视频", audio: "音频", image: "图片", font: "字体" } as Record<
          string,
          string
        >
      )[asset.mediaKind] ?? "素材"
    );
  if (asset.processingStatus === "failed") return "处理失败";
  if (canEditAsset(asset)) return "可剪辑 · 预览准备中";
  return asset.processingStatus === "queued" ? "等待处理" : "正在读取媒体信息";
}

export function assetUnavailableReason(asset: VideoEditorAsset) {
  return asset.processingStatus === "failed"
    ? `“${asset.displayName}”处理失败${asset.error ? `：${asset.error}` : "，请重新上传素材"}`
    : `“${asset.displayName}”正在读取时长，完成后即可拖入时间轴，无需等待预览准备完成。`;
}
