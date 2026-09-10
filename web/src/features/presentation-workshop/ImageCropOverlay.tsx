import { useRef, useState } from "react";
import { cropGesture } from "./cropGeometry";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { Check, X } from "lucide-react";
import type { CropSession } from "./useImageCrop";
import type { SlideElement } from "./types";
export function ImageCropOverlay({
  session,
  scale,
  patch,
  onConfirm,
  onCancel,
}: {
  session: CropSession;
  scale: number;
  patch: (p: Partial<SlideElement>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const gesture = useRef<{
      x: number;
      y: number;
      side: string;
      base: SlideElement;
    } | null>(null),
    e = session.draft;
  return (
    <div
      className="presentation-crop-overlay"
      style={{
        left: e.x,
        top: e.y,
        width: e.width,
        height: e.height,
        transform: `rotate(${e.rotation}deg)`,
        borderWidth: 2 / scale,
      }}
      tabIndex={0}
      aria-label="图片裁剪区域"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          onConfirm();
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = {
          x: event.clientX,
          y: event.clientY,
          side: (event.target as HTMLElement).dataset.cropSide ?? "move",
          base: e,
        };
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g) return;
        event.stopPropagation();
        patch(
          cropGesture(
            g.base,
            session.natural,
            g.side,
            (event.clientX - g.x) / scale,
            (event.clientY - g.y) / scale,
            session.ratio,
          ),
        );
      }}
      onPointerUp={() => {
        gesture.current = null;
      }}
      onPointerCancel={() => {
        if (gesture.current) patch(gesture.current.base);
        gesture.current = null;
      }}
    >
      <div className="presentation-crop-thirds" />
      {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((side) => (
        <button
          key={side}
          tabIndex={-1}
          data-crop-side={side}
          aria-label={`裁剪边缘 ${side}`}
          style={{
            width: 10 / scale,
            height: 10 / scale,
            left: side.includes("w") ? 0 : side.includes("e") ? "100%" : "50%",
            top: side.includes("n") ? 0 : side.includes("s") ? "100%" : "50%",
          }}
        />
      ))}
    </div>
  );
}
export function CropToolbar({
  onConfirm,
  onCancel,
  onPreset,
  naturalRatio,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  onPreset: (r: number | null) => void;
  naturalRatio: number;
}) {
  const [preset, setPreset] = useState("free");
  return (
    <div
      className="presentation-crop-toolbar"
      role="toolbar"
      aria-label="图片裁剪工具栏"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span>裁剪图片</span>
      <CustomSelect
        ariaLabel="裁剪比例"
        value={preset}
        options={[
          { value: "free", label: "自由" },
          { value: "original", label: "原比例" },
          { value: "1", label: "1:1" },
          { value: "1.333333", label: "4:3" },
          { value: "1.777778", label: "16:9" },
        ]}
        onChange={(v) => {
          setPreset(v);
          onPreset(
            v === "free" ? null : v === "original" ? naturalRatio : Number(v),
          );
        }}
      />
      <button className="btn" onClick={onCancel}>
        <X size={15} />
        取消
      </button>
      <button className="btn primary" onClick={onConfirm}>
        <Check size={15} />
        完成裁剪
      </button>
    </div>
  );
}
