import { LinkEditor } from "./LinkEditor";
import { shapes } from "../templates";
import { canContainText } from "../textAdapter";
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { NumberField } from "../PresentationNumberField";
import { useSelectionFormat } from "../useSelectionFormat";
import type { Slide, SlideElement } from "../types";
import { PaintEditor } from "./PaintEditor";

export function AppearancePanel({
  element,
  patch,
  disabled,
  editor,
  onBackground,
  slides,
}: {
  element: SlideElement;
  patch: (values: Partial<SlideElement>) => void;
  disabled: boolean;
  editor: Editor | null;
  onBackground: () => void;
  slides: Slide[];
}) {
  const [open, setOpen] = useState(false);
  const text = canContainText(element.kind),
    image = element.kind === "image";
  const { style, format, paragraph } = useSelectionFormat(
    element,
    editor,
    patch,
  );
  const layout = element.text_layout ?? {
    vertical: false,
    align: "top",
    padding: 8,
    letter_spacing: 0,
    auto_fit: false,
  };
  const effects = element.image_effects ?? {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    grayscale: 0,
    blur: 0,
    tint: null,
    crop_shape: "rect",
  };
  return (
    <section className="presentation-appearance-panel">
      <button
        className="btn"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        高级外观与文字
      </button>
      {open && (
        <fieldset disabled={disabled}>
          <LinkEditor
            key={element.id}
            element={element}
            slides={slides}
            disabled={disabled}
            change={(link) => patch({ link })}
          />
          {text && element.kind !== "text" && (
            <CustomSelect
              ariaLabel="替换形状"
              value={element.kind}
              disabled={disabled}
              options={shapes
                .filter((s) => s.value !== "line")
                .map((s) => ({ value: s.value, label: s.label }))}
              onChange={(kind) => patch({ kind: kind as SlideElement["kind"] })}
            />
          )}
          {element.path && (
            <>
              <button
                className="btn"
                aria-pressed={element.path.closed}
                onClick={() =>
                  patch({
                    path: { ...element.path!, closed: !element.path!.closed },
                  })
                }
              >
                闭合路径
              </button>
              <button
                className="btn"
                aria-pressed={element.path.smooth}
                onClick={() =>
                  patch({
                    path: { ...element.path!, smooth: !element.path!.smooth },
                  })
                }
              >
                平滑曲线
              </button>
              <div className="presentation-path-points">
                {element.path.points.map((point, index) => (
                  <div key={index}>
                    <NumberField
                      label={`顶点 ${index + 1} X`}
                      value={point.x * 100}
                      min={0}
                      max={100}
                      step={0.1}
                      onChange={(x) =>
                        patch({
                          path: {
                            ...element.path!,
                            points: element.path!.points.map((p, i) =>
                              i === index ? { ...p, x: x / 100 } : p,
                            ),
                          },
                        })
                      }
                    />
                    <NumberField
                      label={`顶点 ${index + 1} Y`}
                      value={point.y * 100}
                      min={0}
                      max={100}
                      step={0.1}
                      onChange={(y) =>
                        patch({
                          path: {
                            ...element.path!,
                            points: element.path!.points.map((p, i) =>
                              i === index ? { ...p, y: y / 100 } : p,
                            ),
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {text && (
            <>
              <div className="presentation-object-actions">
                <button
                  className="btn"
                  aria-pressed={!!style.strike}
                  onClick={() => format({ strike: !style.strike })}
                >
                  删除线
                </button>
                <button
                  className="btn"
                  aria-pressed={!!style.code}
                  onClick={() => format({ code: !style.code })}
                >
                  行内代码
                </button>
                <button
                  className="btn"
                  aria-pressed={style.script === "sup"}
                  onClick={() =>
                    format({
                      script: style.script === "sup" ? "normal" : "sup",
                    })
                  }
                >
                  上标
                </button>
                <button
                  className="btn"
                  aria-pressed={style.script === "sub"}
                  onClick={() =>
                    format({
                      script: style.script === "sub" ? "normal" : "sub",
                    })
                  }
                >
                  下标
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    format({
                      bold: false,
                      italic: false,
                      underline: false,
                      strike: false,
                      code: false,
                      script: "normal",
                      highlight: null,
                    })
                  }
                >
                  清除文字格式
                </button>
                <CustomColorPicker
                  ariaLabel="文字高亮"
                  value={style.highlight ?? "#FFFF00"}
                  disabled={disabled}
                  onChange={(highlight) => format({ highlight })}
                />
              </div>
              <button
                className="btn"
                aria-pressed={layout.vertical}
                onClick={() =>
                  patch({
                    text_layout: { ...layout, vertical: !layout.vertical },
                  })
                }
              >
                竖排文字
              </button>
              <button
                className="btn"
                aria-pressed={layout.auto_fit}
                onClick={() =>
                  patch({
                    text_layout: { ...layout, auto_fit: !layout.auto_fit },
                  })
                }
              >
                文本高度自适应
              </button>
              <CustomSelect
                ariaLabel="文字垂直对齐"
                disabled={disabled}
                value={layout.align}
                options={[
                  { value: "top", label: "顶端" },
                  { value: "middle", label: "居中" },
                  { value: "bottom", label: "底端" },
                ]}
                onChange={(align) =>
                  patch({
                    text_layout: {
                      ...layout,
                      align: align as typeof layout.align,
                    },
                  })
                }
              />
              <NumberField
                label="文字内边距"
                value={layout.padding}
                min={0}
                max={100}
                onChange={(padding) =>
                  patch({ text_layout: { ...layout, padding } })
                }
              />
              <NumberField
                label="字间距"
                value={layout.letter_spacing}
                min={-10}
                max={100}
                onChange={(letter_spacing) =>
                  patch({ text_layout: { ...layout, letter_spacing } })
                }
              />
              <NumberField
                label="段落缩进"
                value={element.paragraphs[0]?.indent ?? 0}
                min={0}
                max={8}
                onChange={(indent) => paragraph({ indent: Math.round(indent) })}
              />
              <NumberField
                label="首行缩进"
                value={element.paragraphs[0]?.first_line_indent ?? 0}
                min={-100}
                max={100}
                onChange={(first_line_indent) =>
                  paragraph({ first_line_indent })
                }
              />
              <NumberField
                label="段前间距"
                value={element.paragraphs[0]?.space_before ?? 0}
                min={0}
                max={120}
                onChange={(space_before) => paragraph({ space_before })}
              />
              <NumberField
                label="段后间距"
                value={element.paragraphs[0]?.space_after ?? 0}
                min={0}
                max={120}
                onChange={(space_after) => paragraph({ space_after })}
              />
            </>
          )}
          {text && element.kind !== "text" && (
            <PaintEditor
              label="形状填充"
              value={element.paint}
              disabled={disabled}
              change={(paint) => patch({ paint })}
            />
          )}
          {image && (
            <>
              <button className="btn" onClick={onBackground}>
                设为页面背景
              </button>
              {(
                [
                  "brightness",
                  "contrast",
                  "saturation",
                  "grayscale",
                  "blur",
                ] as const
              ).map((key, i) => (
                <NumberField
                  key={key}
                  label={["亮度", "对比度", "饱和度", "灰度", "模糊"][i]}
                  value={effects[key]}
                  min={0}
                  max={key === "blur" ? 30 : key === "grayscale" ? 1 : 3}
                  step={0.1}
                  onChange={(value) =>
                    patch({ image_effects: { ...effects, [key]: value } })
                  }
                />
              ))}
              <CustomColorPicker
                ariaLabel="图片着色"
                value={effects.tint ?? "#5474E5"}
                disabled={disabled}
                onChange={(tint) =>
                  patch({ image_effects: { ...effects, tint } })
                }
              />
              <CustomSelect
                ariaLabel="图片裁剪形状"
                value={effects.crop_shape}
                disabled={disabled}
                options={[
                  { value: "rect", label: "矩形" },
                  { value: "ellipse", label: "椭圆" },
                  { value: "triangle", label: "三角形" },
                  { value: "diamond", label: "菱形" },
                ]}
                onChange={(crop_shape) =>
                  patch({
                    image_effects: {
                      ...effects,
                      crop_shape: crop_shape as typeof effects.crop_shape,
                    },
                  })
                }
              />
              <button
                className="btn"
                onClick={() => patch({ image_effects: null })}
              >
                重置图片滤镜
              </button>
            </>
          )}
          {!["table", "chart"].includes(element.kind) && (
            <>
              <button
                className="btn"
                aria-pressed={!!element.shadow}
                onClick={() =>
                  patch({
                    shadow: element.shadow
                      ? null
                      : {
                          color: "#000000",
                          x: 4,
                          y: 4,
                          blur: 8,
                          opacity: 0.25,
                        },
                  })
                }
              >
                阴影
              </button>
              {element.shadow && (
                <>
                  <CustomColorPicker
                    ariaLabel="阴影颜色"
                    value={element.shadow.color}
                    disabled={disabled}
                    onChange={(color) =>
                      patch({ shadow: { ...element.shadow!, color } })
                    }
                  />
                  {(["x", "y", "blur", "opacity"] as const).map((key, i) => (
                    <NumberField
                      key={key}
                      label={
                        [
                          "阴影水平偏移",
                          "阴影垂直偏移",
                          "阴影模糊",
                          "阴影透明度",
                        ][i]
                      }
                      value={element.shadow![key]}
                      min={key === "x" || key === "y" ? -100 : 0}
                      max={key === "opacity" ? 1 : 100}
                      step={key === "opacity" ? 0.05 : 1}
                      onChange={(value) =>
                        patch({ shadow: { ...element.shadow!, [key]: value } })
                      }
                    />
                  ))}
                </>
              )}
            </>
          )}
        </fieldset>
      )}
    </section>
  );
}
