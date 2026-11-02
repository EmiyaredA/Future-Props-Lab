import { LoadingState } from "@shared/ui/LoadingState";
import { useEffect, useState } from "react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { NumberField } from "./PresentationNumberField";
import { imageBlob, previewSvg } from "./api";
import type { SlideElement } from "./types";
export function MediaAppearance({
  element,
  patch,
  disabled = false,
}: {
  element: SlideElement;
  patch: (p: Partial<SlideElement>) => void;
  disabled?: boolean;
}) {
  const [mono, setMono] = useState<{ id: string; value: boolean } | null>(null);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setFailure("");
    if (element.kind === "vector" && element.asset_id && !disabled) {
      const id = element.asset_id;
      void imageBlob(id)
        .then((b) => b.text())
        .then((svg) => previewSvg(svg, controller.signal))
        .then((result) => {
          if (active) setMono({ id, value: result.monochrome });
        })
        .catch(() => {
          if (active) setFailure("读取矢量颜色信息失败");
        });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [element.kind, element.asset_id, disabled, attempt]);
  return (
    <fieldset className="presentation-media-appearance" disabled={disabled}>
      <legend>{element.kind === "vector" ? "矢量外观" : "图片外观"}</legend>
      <NumberField
        label="整体不透明度（%）"
        value={(element.opacity ?? 1) * 100}
        min={0}
        max={100}
        onChange={(v) => patch({ opacity: v / 100 })}
      />
      {element.kind === "vector" ? (
        mono?.id === element.asset_id && mono.value ? (
          <>
            <label className="presentation-field">
              图标颜色
              <CustomColorPicker
                ariaLabel="图标颜色"
                value={element.vector_color ?? "#334155"}
                onChange={(vector_color) => patch({ vector_color })}
              />
            </label>
            <button
              className="btn"
              onClick={() => patch({ vector_color: null })}
            >
              恢复原色
            </button>
          </>
        ) : failure ? (
          <p role="alert">
            {failure}{" "}
            <button className="btn" onClick={() => setAttempt(attempt + 1)}>
              重试
            </button>
          </p>
        ) : (
          <p className="muted">
            {mono?.id === element.asset_id ? (
              "保留 SVG 原始配色"
            ) : (
              <LoadingState variant="inline" label="正在读取颜色信息…" />
            )}
          </p>
        )
      ) : (
        <>
          <NumberField
            label="图片圆角"
            value={element.corner_radius ?? 0}
            min={0}
            max={Math.min(element.width, element.height) / 2}
            onChange={(corner_radius) => patch({ corner_radius })}
          />
          <button
            className="btn"
            aria-pressed={element.image_border ?? false}
            onClick={() =>
              patch({
                image_border: !element.image_border,
                stroke_width: element.stroke_width || 1,
              })
            }
          >
            图片边框
          </button>
          {element.image_border && (
            <>
              <label className="presentation-field">
                边框颜色
                <CustomColorPicker
                  ariaLabel="图片边框颜色"
                  value={element.stroke}
                  onChange={(stroke) => patch({ stroke })}
                />
              </label>
              <NumberField
                label="图片边框宽度"
                value={element.stroke_width}
                min={0}
                max={30}
                onChange={(stroke_width) => patch({ stroke_width })}
              />
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
