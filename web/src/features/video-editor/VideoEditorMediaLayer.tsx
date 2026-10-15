import type { CSSProperties } from "react";
import { VideoEditorEffectImage } from "./VideoEditorEffectImage";
import { VideoEditorProxyVideo } from "./VideoEditorProxyVideo";
import type { PreviewMediaGeometry } from "./previewGeometry";
import type { VideoEditorClip, VideoEditorAsset } from "./types";
export function VideoEditorMediaLayer({
  clip,
  asset,
  geometry,
  style,
  localUs,
  playing,
  selected,
  spinBlur,
}: {
  clip: VideoEditorClip;
  asset?: VideoEditorAsset;
  geometry?: PreviewMediaGeometry;
  style: CSSProperties;
  localUs: number;
  playing: boolean;
  selected: boolean;
  spinBlur?: number;
}) {
  return (
    <div
      className={`ve-stage-layer ${selected ? "selected" : ""}`}
      style={style}
    >
      <div
        className="ve-stage-media-content"
        style={{ transform: clip.flipX ? "scaleX(-1)" : undefined }}
      >
        {clip.kind === "video" && asset?.proxyUrl && geometry?.proxyCrop ? (
          <div className="ve-stage-media-crop">
            <VideoEditorProxyVideo
              source={asset.proxyUrl}
              clip={clip}
              localUs={localUs}
              playing={playing}
              crop={geometry.proxyCrop}
              chromaKey={clip.chromaKey}
              spinBlur={spinBlur}
            />
          </div>
        ) : clip.kind === "video" && asset && !asset.proxyUrl ? (
          <span className="ve-media-pending">
            {asset.processingStatus === "failed"
              ? "视频预览处理失败，请检查素材"
              : "视频预览准备中，可继续剪辑"}
          </span>
        ) : clip.kind === "image" && asset ? (
          <VideoEditorEffectImage
            source={`/v1/files/${asset.id}/content`}
            chromaKey={clip.chromaKey}
            spinBlur={spinBlur}
          />
        ) : clip.kind === "color" ? (
          <i style={{ background: clip.color ?? "#000" }} />
        ) : null}
      </div>
    </div>
  );
}
