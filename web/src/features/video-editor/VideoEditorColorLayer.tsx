import { useLayoutEffect, useRef } from "react";
import { paintPageCurlCanvas, type PageCurlEffect } from "./pageCurlCanvas";

export function VideoEditorColorLayer({
  color,
  pageCurl,
  width,
  height,
}: {
  color: string;
  pageCurl?: PageCurlEffect;
  width: number;
  height: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const surface = canvas.current;
    if (!surface || !pageCurl) return;
    const ratio = Math.min(1, 960 / width);
    surface.width = Math.max(1, Math.round(width * ratio));
    surface.height = Math.max(1, Math.round(height * ratio));
    const context = surface.getContext("2d");
    if (!context) return;
    context.fillStyle = color;
    context.fillRect(0, 0, surface.width, surface.height);
    paintPageCurlCanvas(surface, pageCurl);
  }, [color, pageCurl, width, height]);
  return pageCurl ? (
    <canvas
      ref={canvas}
      style={{ width: "100%", height: "100%" }}
      aria-hidden
    />
  ) : (
    <i style={{ background: color }} />
  );
}
