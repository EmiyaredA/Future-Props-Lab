import { useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { NumberField } from "../PresentationNumberField";
import { MediaChooser } from "./MediaChooser";
import { defaultPaint, type Paint } from "./paintStyle";

export function PaintEditor({
  value,
  change,
  disabled,
  label,
}: {
  value: Paint | null | undefined;
  change: (value: Paint | null) => void;
  disabled: boolean;
  label: string;
}) {
  const paint = value ?? defaultPaint;
  const [pendingImage, setPendingImage] = useState(false);
  const type = pendingImage ? "image" : value ? paint.type : "default";
  return (
    <fieldset disabled={disabled} className="presentation-paint-editor">
      <legend>{label}</legend>
      <CustomSelect
        ariaLabel={`${label}类型`}
        value={type}
        disabled={disabled}
        options={[
          { value: "default", label: "沿用基础颜色" },
          { value: "solid", label: "纯色" },
          { value: "linear", label: "线性渐变" },
          { value: "radial", label: "径向渐变" },
          { value: "image", label: "图片" },
        ]}
        onChange={(type) => {
          setPendingImage(type === "image" && !paint.asset_id);
          if (type === "image" && !paint.asset_id) return;
          if (type === "default") change(null);
          else if (type !== "image")
            change({ ...paint, type: type as Paint["type"], asset_id: null });
          else change({ ...paint, type: "image" });
        }}
      />
      {value && (
        <>
          <CustomColorPicker
            ariaLabel={`${label}起始颜色`}
            value={paint.color}
            disabled={disabled}
            onChange={(color) => change({ ...paint, color })}
          />
          {(paint.type === "linear" || paint.type === "radial") && (
            <>
              <CustomColorPicker
                ariaLabel={`${label}结束颜色`}
                value={paint.end_color}
                disabled={disabled}
                onChange={(end_color) => change({ ...paint, end_color })}
              />
              <NumberField
                label={`${label}角度`}
                value={paint.angle}
                min={0}
                max={360}
                onChange={(angle) => change({ ...paint, angle })}
              />
            </>
          )}
        </>
      )}
      {!disabled && type === "image" && (
        <MediaChooser
          kind="image"
          value={paint.asset_id ?? null}
          label={`${label}图片`}
          change={(asset_id) => {
            setPendingImage(false);
            change({ ...paint, type: "image", asset_id });
          }}
        />
      )}
      {type === "image" && paint.asset_id && (
        <CustomSelect
          ariaLabel={`${label}图片适应`}
          disabled={disabled}
          value={paint.fit}
          options={[
            { value: "cover", label: "等比填充" },
            { value: "contain", label: "完整显示" },
            { value: "repeat", label: "256px 平铺" },
          ]}
          onChange={(fit) => change({ ...paint, fit: fit as Paint["fit"] })}
        />
      )}
    </fieldset>
  );
}
