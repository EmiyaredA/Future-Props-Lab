import { useEffect, useRef, type CSSProperties } from "react";
import { paintChromaCanvas } from "./chromaCanvas";
import { VideoEditorProxyVideo } from "./VideoEditorProxyVideo";
import type { PreviewMediaGeometry } from "./previewGeometry";
import type { VideoEditorClip, VideoEditorAsset } from "./types";
function ChromaImage({
  source,
  chromaKey,
}: {
  source: string;
  chromaKey: NonNullable<VideoEditorClip["chromaKey"]>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = new window.Image();
    node.onload = () => {
      if (canvas.current)
        paintChromaCanvas(
          canvas.current,
          node,
          node.naturalWidth,
          node.naturalHeight,
          chromaKey,
        );
    };
    node.src = source;
    return () => {
      node.onload = null;
    };
  }, [source, chromaKey]);
  return <canvas ref={canvas} className="ve-keyed-image" aria-hidden />;
}

export function VideoEditorMediaLayer({
  clip,
  asset,
  geometry,
  style,
  localUs,
  playing,
  selected,
}: {
  clip: VideoEditorClip;
  asset?: VideoEditorAsset;
  geometry?: PreviewMediaGeometry;
  style: CSSProperties;
  localUs: number;
  playing: boolean;
  selected: boolean;
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
            />
          </div>
        ) : clip.kind === "video" && asset && !asset.proxyUrl ? (
          <span className="ve-media-pending">
            {asset.processingStatus === "failed"
              ? "视频预览处理失败，请检查素材"
              : "视频预览准备中，可继续剪辑"}
          </span>
        ) : clip.kind === "image" && asset && clip.chromaKey?.enabled ? (
          <ChromaImage
            source={`/v1/files/${asset.id}/content`}
            chromaKey={clip.chromaKey}
          />
        ) : clip.kind === "image" && asset ? (
          <img src={`/v1/files/${asset.id}/content`} alt="" draggable={false} />
        ) : clip.kind === "color" ? (
          <i style={{ background: clip.color ?? "#000" }} />
        ) : null}
      </div>
    </div>
  );
}
