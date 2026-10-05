import type { CSSProperties } from "react";
import { clipOpacityAt } from "./editorModel";
import type { PreviewTransitionEffect } from "./previewTransitions";
import { anchorPoint, transformAt, type ClipTransform } from "./transformModel";
import type { VideoEditorAsset, VideoEditorClip } from "./types";

export const VIDEO_EDITOR_CANVAS_WIDTH = 1920;
export const VIDEO_EDITOR_CANVAS_HEIGHT = 1080;

const VIDEO_PROXY_WIDTH = 960;
const VIDEO_PROXY_HEIGHT = 540;

type Dimensions = {
  width: number;
  height: number;
};

type ProbeStream = {
  codec_type?: unknown;
  width?: unknown;
  height?: unknown;
};

export type VideoProxyCrop = {
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
};

export type PreviewMediaGeometry = Dimensions & {
  proxyCrop?: VideoProxyCrop;
};

const positiveNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;

export function mediaProbeDimensions(
  asset?: VideoEditorAsset,
): Dimensions | undefined {
  const probe = asset?.probe;
  if (!probe || typeof probe !== "object") return undefined;
  const streams = Array.isArray(probe.streams)
    ? (probe.streams as ProbeStream[])
    : [];
  const stream = streams.find(
    (item) =>
      item?.codec_type === "video" &&
      positiveNumber(item.width) &&
      positiveNumber(item.height),
  );
  const width = positiveNumber(stream?.width) ?? positiveNumber(probe.width);
  const height = positiveNumber(stream?.height) ?? positiveNumber(probe.height);
  return width && height ? { width, height } : undefined;
}

function fittedDimensions(
  clip: VideoEditorClip,
  source: Dimensions,
  canvas: Dimensions,
): Dimensions {
  if (clip.fitMode === "cover" || clip.fitMode === "contain") {
    const ratio =
      clip.fitMode === "cover"
        ? Math.max(canvas.width / source.width, canvas.height / source.height)
        : Math.min(canvas.width / source.width, canvas.height / source.height);
    return { width: source.width * ratio, height: source.height * ratio };
  }
  if (clip.fitMode === "height" && clip.heightPercent) {
    const ratio = (canvas.height * clip.heightPercent) / 100 / source.height;
    return { width: source.width * ratio, height: source.height * ratio };
  }
  return source;
}

export function paddedVideoProxyCrop(source: Dimensions): VideoProxyCrop {
  const proxyScale = Math.min(
    VIDEO_PROXY_WIDTH / source.width,
    VIDEO_PROXY_HEIGHT / source.height,
  );
  const contentWidth = source.width * proxyScale;
  const contentHeight = source.height * proxyScale;
  return {
    leftPercent:
      (-((VIDEO_PROXY_WIDTH - contentWidth) / 2) / contentWidth) * 100,
    topPercent:
      (-((VIDEO_PROXY_HEIGHT - contentHeight) / 2) / contentHeight) * 100,
    widthPercent: (VIDEO_PROXY_WIDTH / contentWidth) * 100,
    heightPercent: (VIDEO_PROXY_HEIGHT / contentHeight) * 100,
  };
}

export function previewMediaGeometry(
  clip: VideoEditorClip,
  asset?: VideoEditorAsset,
  canvas: Dimensions = {
    width: VIDEO_EDITOR_CANVAS_WIDTH,
    height: VIDEO_EDITOR_CANVAS_HEIGHT,
  },
): PreviewMediaGeometry | undefined {
  if (clip.kind === "color")
    return {
      width: canvas.width,
      height: canvas.height,
    };
  if (clip.kind !== "video" && clip.kind !== "image") return undefined;
  const source = mediaProbeDimensions(asset) ?? {
    width: VIDEO_EDITOR_CANVAS_WIDTH,
    height: VIDEO_EDITOR_CANVAS_HEIGHT,
  };
  return {
    ...fittedDimensions(clip, source, canvas),
    proxyCrop: clip.kind === "video" ? paddedVideoProxyCrop(source) : undefined,
  };
}

export function previewLayerStyle(
  clip: VideoEditorClip,
  localUs: number,
  effect: PreviewTransitionEffect,
  geometry: PreviewMediaGeometry | undefined,
  canvas: { width: number; height: number },
  transform: ClipTransform = transformAt(clip, localUs),
): CSSProperties {
  const anchor = anchorPoint(transform.anchor);
  return {
    left: `${(transform.x / canvas.width) * 100}%`,
    top: `${(transform.y / canvas.height) * 100}%`,
    width: geometry ? `${(geometry.width / canvas.width) * 100}%` : undefined,
    height: geometry
      ? `${(geometry.height / canvas.height) * 100}%`
      : undefined,
    opacity: clipOpacityAt(clip, localUs) * effect.opacityMultiplier,
    filter: `brightness(${transform.brightness})${effect.blurPx > 0 ? ` blur(${effect.blurPx}px)` : ""}`,
    clipPath: effect.clipPath,
    transformOrigin: `${anchor.x * 100}% ${anchor.y * 100}%`,
    transform: `translate(${-anchor.x * 100}%, ${-anchor.y * 100}%) rotate(${transform.rotation}deg) scale(${transform.scaleX * effect.scaleMultiplier * (clip.kind === "text" && clip.flipX ? -1 : 1)}, ${transform.scaleY * effect.scaleMultiplier})`,
  };
}
