import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { useCallback, useLayoutEffect, useRef } from "react";
import { paintChromaCanvas } from "./chromaCanvas";
import { paintSpinBlurCanvas } from "./spinBlurCanvas";
import {
  paintWhipPanCanvas,
  type WhipPanEffect,
} from "./directionalTransitionCanvas";
import type { VideoEditorClip } from "./types";
import { noTimedEffects, type ActiveTimedEffect } from "./timedEffects";
import { paintTimedEffectsCanvas } from "./timedEffectsCanvas";

/** Reuse the loaded image for chroma key and angular blur, including text PNGs. */
export function VideoEditorEffectImage({
  source,
  alt = "",
  chromaKey,
  spinBlur = 0,
  whipPan,
  timedEffects = noTimedEffects,
  fittedWidth,
  onSize,
}: {
  source: string;
  alt?: string;
  chromaKey?: VideoEditorClip["chromaKey"];
  spinBlur?: number;
  whipPan?: WhipPanEffect;
  timedEffects?: ActiveTimedEffect[];
  fittedWidth?: number;
  onSize?: (size: { width: number; height: number }) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const processed = Boolean(
    chromaKey?.enabled || spinBlur || whipPan || timedEffects.length,
  );
  const paint = useCallback(() => {
    const node = image.current;
    const surface = canvas.current;
    if (!node?.complete || !node.naturalWidth || !surface) return;
    if (chromaKey?.enabled) {
      paintChromaCanvas(
        surface,
        node,
        node.naturalWidth,
        node.naturalHeight,
        chromaKey,
      );
      if (timedEffects.length)
        paintTimedEffectsCanvas(surface, timedEffects, fittedWidth);
      if (spinBlur)
        paintSpinBlurCanvas(
          surface,
          surface,
          surface.width,
          surface.height,
          spinBlur,
        );
    } else {
      paintSpinBlurCanvas(
        surface,
        node,
        node.naturalWidth,
        node.naturalHeight,
        timedEffects.length ? 0 : spinBlur,
      );
      if (timedEffects.length) {
        paintTimedEffectsCanvas(surface, timedEffects, fittedWidth);
        if (spinBlur)
          paintSpinBlurCanvas(
            surface,
            surface,
            surface.width,
            surface.height,
            spinBlur,
          );
      }
    }
    if (whipPan)
      paintWhipPanCanvas(
        surface,
        surface,
        surface.width,
        surface.height,
        whipPan,
      );
  }, [chromaKey, spinBlur, whipPan, timedEffects, fittedWidth]);
  useLayoutEffect(paint, [paint, source]);
  return (
    <>
      <ResponsiveImage
        ref={image}
        src={source}
        alt={alt}
        draggable={false}
        style={processed ? { display: "none" } : undefined}
        onLoad={(event) => {
          onSize?.({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          });
          paint();
        }}
      />
      {processed && (
        <canvas
          ref={canvas}
          className="ve-keyed-image"
          style={{ display: "block", width: "100%", height: "100%" }}
          aria-label={alt || undefined}
          aria-hidden={!alt}
        />
      )}
    </>
  );
}
