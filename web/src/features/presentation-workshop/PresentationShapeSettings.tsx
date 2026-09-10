import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { NumberField } from "./PresentationNumberField";
import type { SlideElement } from "./types";

export function PresentationShapeSettings({
  element,
  patch,
  disabled,
  advancedOnly = false,
}: {
  element: SlideElement;
  patch: (value: Partial<SlideElement>) => void;
  disabled: boolean;
  advancedOnly?: boolean;
}) {
  return (
    <fieldset className="presentation-desktop-control" disabled={disabled}>
      <legend>图形样式</legend>
      {element.kind !== "line" ? (
        <>
          {!advancedOnly && (
            <label className="presentation-field">
              填充
              <CustomColorPicker
                ariaLabel="填充颜色"
                disabled={disabled}
                value={element.fill}
                onChange={(fill) => patch({ fill })}
              />
            </label>
          )}
          <NumberField
            label="填充不透明度（%）"
            value={(element.fill_opacity ?? 1) * 100}
            min={0}
            max={100}
            onChange={(value) => patch({ fill_opacity: value / 100 })}
          />
        </>
      ) : null}
      {!advancedOnly && (
        <>
          <label className="presentation-field">
            描边
            <CustomColorPicker
              ariaLabel="描边颜色"
              disabled={disabled}
              value={element.stroke}
              onChange={(stroke) => patch({ stroke })}
            />
          </label>
          <NumberField
            label="描边宽度"
            value={element.stroke_width}
            min={0}
            max={30}
            step={0.25}
            onChange={(stroke_width) => patch({ stroke_width })}
          />
          <CustomSelect
            ariaLabel="描边样式"
            disabled={disabled}
            value={element.stroke_dash ?? "solid"}
            options={[
              { value: "solid", label: "实线" },
              { value: "dash", label: "虚线" },
              { value: "dot", label: "点线" },
            ]}
            onChange={(value) =>
              patch({ stroke_dash: value as SlideElement["stroke_dash"] })
            }
          />
          {element.kind === "line"
            ? (["start_arrow", "end_arrow"] as const).map((key, i) => (
                <CustomSelect
                  key={key}
                  ariaLabel={i ? "终点箭头" : "起点箭头"}
                  disabled={disabled}
                  value={element[key] ?? "none"}
                  options={[
                    {
                      value: "none",
                      label: i ? "终点：无箭头" : "起点：无箭头",
                    },
                    {
                      value: "triangle",
                      label: i ? "终点：三角箭头" : "起点：三角箭头",
                    },
                  ]}
                  onChange={(value) => patch({ [key]: value })}
                />
              ))
            : null}
        </>
      )}
      {element.kind === "roundRect" ? (
        <>
          <NumberField
            label="圆角半径"
            min={0}
            max={5000}
            value={
              element.corner_radius ??
              Math.min(element.width, element.height) * 0.166
            }
            onChange={(corner_radius) => patch({ corner_radius })}
          />
          <button
            className="btn"
            onClick={() => patch({ corner_radius: null })}
          >
            自动圆角
          </button>
        </>
      ) : null}
    </fieldset>
  );
}
