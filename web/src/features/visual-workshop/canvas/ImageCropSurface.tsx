import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  drawCrop,
  resizeCrop,
  type CropRect,
  type CropSide,
} from "./imageCropGeometry";

const HANDLES: Array<[CropSide, string]> = [
  ["nw", "左上角"],
  ["n", "上边缘"],
  ["ne", "右上角"],
  ["e", "右边缘"],
  ["se", "右下角"],
  ["s", "下边缘"],
  ["sw", "左下角"],
  ["w", "左边缘"],
];

export function ImageCropSurface({
  image,
  rect,
  ratio,
  disabled,
  onChange,
}: {
  image: ImageBitmap;
  rect: CropRect;
  ratio: number | null;
  disabled: boolean;
  onChange: (rect: CropRect) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const gesture = useRef<{
    base: CropRect;
    x: number;
    y: number;
    side: CropSide | "draw";
  } | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setBounds({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    setBounds({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    canvas.current?.getContext("2d")?.drawImage(image, 0, 0);
    selection.current?.focus();
  }, [image]);
  const scale = Math.min(
    bounds.width / image.width,
    bounds.height / image.height,
    1,
  );
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * image.width) / box.width,
      y: ((event.clientY - box.top) * image.height) / box.height,
    };
  };
  return (
    <div className="image-crop-stage" ref={container}>
      <div
        className="image-crop-image"
        style={{ width: image.width * scale, height: image.height * scale }}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.preventDefault();
          const target = event.target as HTMLElement;
          const handle = target.closest<HTMLElement>("[data-crop-side]");
          const side = (handle?.dataset.cropSide ?? "draw") as
            CropSide | "draw";
          (handle ?? selection.current)?.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = { base: rect, ...point(event), side };
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g || disabled) return;
          const p = point(event);
          onChange(
            g.side === "draw"
              ? drawCrop(g, p, image, ratio)
              : resizeCrop(g.base, image, g.side, p.x - g.x, p.y - g.y, ratio),
          );
        }}
        onPointerUp={(event) => {
          gesture.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          if (gesture.current) onChange(gesture.current.base);
          gesture.current = null;
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
        }}
        onKeyDown={(event) => {
          if (disabled || !event.key.startsWith("Arrow")) return;
          const side = (event.target as HTMLElement).dataset.cropSide as
            CropSide | undefined;
          if (!side) return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 10 : 1;
          onChange(
            resizeCrop(
              rect,
              image,
              side,
              event.key === "ArrowLeft"
                ? -step
                : event.key === "ArrowRight"
                  ? step
                  : 0,
              event.key === "ArrowUp"
                ? -step
                : event.key === "ArrowDown"
                  ? step
                  : 0,
              ratio,
            ),
          );
        }}
      >
        <canvas
          ref={canvas}
          width={image.width}
          height={image.height}
          aria-label="裁剪原图"
        />
        <div
          ref={selection}
          className="image-crop-selection"
          data-crop-side="move"
          tabIndex={disabled ? -1 : 0}
          role="group"
          aria-label="裁剪选区，方向键移动，Shift 加速"
          style={{
            left: `${(rect.x / image.width) * 100}%`,
            top: `${(rect.y / image.height) * 100}%`,
            width: `${(rect.width / image.width) * 100}%`,
            height: `${(rect.height / image.height) * 100}%`,
          }}
        >
          <div className="image-crop-thirds" />
          {HANDLES.map(([side, label]) => (
            <button
              type="button"
              key={side}
              disabled={disabled}
              data-crop-side={side}
              className={`image-crop-handle is-${side}`}
              aria-label={`调整裁剪${label}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
