import { useId, useState } from "react";
import type { Editor } from "@tiptap/react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { Slide, SlideElement, TextRun } from "./types";
import { defaultRun } from "./templates";

function NumberField({
  label,
  value,
  min = -10000,
  max = 10000,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="presentation-field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={Math.round(value * 100) / 100}
        onChange={(e) => {
          if (e.target.value !== "" && Number.isFinite(Number(e.target.value)))
            onChange(Math.max(min, Math.min(max, Number(e.target.value))));
        }}
      />
    </label>
  );
}
export function PresentationInspector({
  slide,
  selected,
  patch,
  background,
  editor,
  arrange,
  order,
  editText,
  readOnly,
}: {
  slide: Slide;
  selected: string[];
  patch: (patch: Partial<SlideElement>) => void;
  background: (color: string) => void;
  editor: Editor | null;
  arrange: (mode: string) => void;
  order: (mode: string) => void;
  editText: () => void;
  readOnly: boolean;
}) {
  const elements = slide.elements.filter((e) => selected.includes(e.id));
  const element = elements.length === 1 ? elements[0] : null;
  const selectionKey = `${slide.id}:${selected.join(",")}`;
  const [tabState, setTabState] = useState({
    selectionKey,
    tab: selected.length ? "elements" : "page",
  });
  const tab =
    tabState.selectionKey === selectionKey
      ? tabState.tab
      : selected.length
        ? "elements"
        : "page";
  if (tabState.selectionKey !== selectionKey) {
    setTabState({ selectionKey, tab });
  }
  const tabId = useId();
  const colors = ["#132338", "#FFFFFF", "#E7EAEE", "#F5F1E8", "#F4DED5"];
  const disabled = readOnly || !!element?.locked;
  const run = element?.paragraphs[0]?.runs[0] ?? defaultRun();
  const format = (values: Partial<TextRun>) => {
    if (disabled || !element) return;
    if (editor) {
      const chain = editor.chain().focus();
      if (values.font) chain.setFontFamily(values.font);
      if (values.size) chain.setFontSize(`${values.size}px`);
      if (values.color) chain.setColor(values.color);
      if (values.bold !== undefined) chain.toggleBold();
      if (values.italic !== undefined) chain.toggleItalic();
      if (values.underline !== undefined) chain.toggleUnderline();
      chain.run();
    } else
      patch({
        paragraphs: element.paragraphs.map((p) => ({
          ...p,
          runs: p.runs.map((r) => ({ ...r, ...values })),
        })),
      });
  };
  return (
    <aside className="presentation-inspector" aria-label="格式面板">
      <div
        className="presentation-inspector-tabs"
        role="tablist"
        aria-label="设置分类"
      >
        {["page", "elements"].map((value, index) => (
          <button
            key={value}
            id={`${tabId}-${value}`}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`${tabId}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTabState({ selectionKey, tab: value })}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "page"
                    : event.key === "End"
                      ? "elements"
                      : value === "page"
                        ? "elements"
                        : "page";
                setTabState({ selectionKey, tab: next });
                document.getElementById(`${tabId}-${next}`)?.focus();
              }
            }}
          >
            {index === 0 ? "页面" : "元素"}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-${tab}`}
      >
        <h3>
          {tab === "elements" && elements.length
            ? elements.length > 1
              ? `${elements.length} 个元素`
              : element?.kind === "text"
                ? "文本格式"
                : "元素格式"
            : tab === "page"
              ? "页面设置"
              : "元素设置"}
        </h3>
        {tab === "page" ? (
          <>
            <div className="presentation-field">
              <span>页面比例</span>
              <span className="presentation-page-ratio">16:9 宽屏</span>
            </div>
            <label className="presentation-field">
              页面背景
              <CustomColorPicker
                ariaLabel="页面背景颜色"
                value={slide.background}
                onChange={background}
                disabled={readOnly}
              />
            </label>
            <div className="presentation-page-colors" aria-label="背景快捷色板">
              {colors.map((color) => (
                <button
                  key={color}
                  aria-label={`页面背景 ${color}`}
                  aria-pressed={slide.background.toUpperCase() === color}
                  disabled={readOnly}
                  style={{ backgroundColor: color }}
                  onClick={() => background(color)}
                />
              ))}
            </div>
            <p className="muted presentation-page-hint">
              选择画布中的元素，调整文字、图形与图片样式。
            </p>
          </>
        ) : null}
        {tab === "elements" && !elements.length && (
          <p className="muted">选择元素调整样式，双击文本框编辑文字。</p>
        )}
        {tab === "elements" && (
          <>
            {elements.length > 0 ? (
              <button
                className="btn presentation-desktop-control"
                disabled={readOnly}
                onClick={() =>
                  patch({ locked: !elements.every((e) => e.locked) })
                }
              >
                {elements.every((e) => e.locked) ? "解锁元素" : "锁定元素"}
              </button>
            ) : null}
            {element ? (
              <>
                <fieldset
                  disabled={disabled}
                  className="presentation-geometry presentation-desktop-control"
                >
                  <legend>位置与大小</legend>
                  <NumberField
                    label="X"
                    value={element.x}
                    onChange={(x) => patch({ x })}
                  />
                  <NumberField
                    label="Y"
                    value={element.y}
                    onChange={(y) => patch({ y })}
                  />
                  <NumberField
                    label="宽度"
                    value={element.width}
                    min={1}
                    onChange={(width) =>
                      patch({
                        width,
                        ...(element.kind === "image"
                          ? {
                              height: Math.min(
                                10000,
                                (element.height * width) / element.width,
                              ),
                            }
                          : {}),
                      })
                    }
                  />
                  <NumberField
                    label="高度"
                    value={element.height}
                    min={1}
                    onChange={(height) =>
                      patch({
                        height,
                        ...(element.kind === "image"
                          ? {
                              width: Math.min(
                                10000,
                                (element.width * height) / element.height,
                              ),
                            }
                          : {}),
                      })
                    }
                  />
                  <NumberField
                    label="旋转角度"
                    value={element.rotation}
                    min={-360}
                    max={360}
                    onChange={(rotation) => patch({ rotation })}
                  />
                </fieldset>
                {element.kind === "text" ? (
                  <>
                    <button
                      className="btn"
                      onClick={editText}
                      disabled={disabled}
                    >
                      编辑文字
                    </button>
                    <div className="presentation-desktop-control">
                      <CustomSelect
                        ariaLabel="字体"
                        value={run.font}
                        disabled={disabled}
                        options={[
                          { value: "Microsoft YaHei", label: "微软雅黑" },
                          { value: "Arial", label: "Arial" },
                        ]}
                        onChange={(font) =>
                          format({ font: font as TextRun["font"] })
                        }
                      />
                      <NumberField
                        label="字号"
                        value={run.size}
                        min={6}
                        max={240}
                        onChange={(size) => format({ size })}
                      />
                      <div
                        className="presentation-format-buttons"
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <button
                          aria-label="粗体"
                          aria-pressed={
                            editor ? editor.isActive("bold") : run.bold
                          }
                          disabled={disabled}
                          onClick={() => format({ bold: !run.bold })}
                        >
                          <b>B</b>
                        </button>
                        <button
                          aria-label="斜体"
                          aria-pressed={
                            editor ? editor.isActive("italic") : run.italic
                          }
                          disabled={disabled}
                          onClick={() => format({ italic: !run.italic })}
                        >
                          <i>I</i>
                        </button>
                        <button
                          aria-label="下划线"
                          aria-pressed={
                            editor
                              ? editor.isActive("underline")
                              : run.underline
                          }
                          disabled={disabled}
                          onClick={() => format({ underline: !run.underline })}
                        >
                          <u>U</u>
                        </button>
                      </div>
                      <CustomColorPicker
                        ariaLabel="文字颜色"
                        value={run.color}
                        disabled={disabled}
                        onChange={(color) => format({ color })}
                      />
                      <CustomSelect
                        ariaLabel="文字对齐"
                        value={element.paragraphs[0]?.align ?? "left"}
                        disabled={disabled}
                        options={[
                          { value: "left", label: "左对齐" },
                          { value: "center", label: "居中" },
                          { value: "right", label: "右对齐" },
                        ]}
                        onChange={(align) => {
                          if (editor)
                            editor.chain().focus().setTextAlign(align).run();
                          else
                            patch({
                              paragraphs: element.paragraphs.map((p) => ({
                                ...p,
                                align: align as "left" | "center" | "right",
                              })),
                            });
                        }}
                      />
                      <NumberField
                        label="行距"
                        value={element.paragraphs[0]?.line_height ?? 1.3}
                        min={1}
                        max={3}
                        step={0.1}
                        onChange={(line_height) => {
                          if (editor)
                            editor
                              .chain()
                              .focus()
                              .updateAttributes("paragraph", {
                                lineHeight: line_height,
                              })
                              .run();
                          else
                            patch({
                              paragraphs: element.paragraphs.map((p) => ({
                                ...p,
                                line_height,
                              })),
                            });
                        }}
                      />
                      <button
                        className="btn"
                        disabled={disabled}
                        aria-pressed={element.paragraphs[0]?.bullet}
                        onClick={() => {
                          const bullet = !element.paragraphs[0]?.bullet;
                          if (editor)
                            editor
                              .chain()
                              .focus()
                              .updateAttributes("paragraph", { bullet })
                              .run();
                          else
                            patch({
                              paragraphs: element.paragraphs.map((p) => ({
                                ...p,
                                bullet,
                              })),
                            });
                        }}
                      >
                        项目符号
                      </button>
                    </div>
                  </>
                ) : element.kind === "image" ? (
                  <fieldset
                    className="presentation-desktop-control"
                    disabled={disabled}
                  >
                    <legend>矩形裁剪（%）</legend>
                    <p className="muted">等比填充，超出图片框的部分隐藏。</p>
                    {(["left", "top", "right", "bottom"] as const).map(
                      (side, i) => (
                        <NumberField
                          key={side}
                          label={
                            ["裁剪左侧", "裁剪顶部", "裁剪右侧", "裁剪底部"][i]
                          }
                          min={0}
                          max={Math.max(
                            0,
                            98 -
                              element.crop[
                                (
                                  {
                                    left: "right",
                                    right: "left",
                                    top: "bottom",
                                    bottom: "top",
                                  } as const
                                )[side]
                              ] *
                                100,
                          )}
                          value={element.crop[side] * 100}
                          onChange={(value) =>
                            patch({
                              crop: { ...element.crop, [side]: value / 100 },
                            })
                          }
                        />
                      ),
                    )}
                    <button
                      className="btn"
                      onClick={() =>
                        patch({
                          crop: { left: 0, right: 0, top: 0, bottom: 0 },
                        })
                      }
                    >
                      重置裁剪
                    </button>
                  </fieldset>
                ) : (
                  <div className="presentation-desktop-control">
                    <label className="presentation-field">
                      填充
                      <CustomColorPicker
                        ariaLabel="填充颜色"
                        disabled={disabled}
                        value={element.fill}
                        onChange={(fill) => patch({ fill })}
                      />
                    </label>
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
                      onChange={(stroke_width) => patch({ stroke_width })}
                    />
                  </div>
                )}
              </>
            ) : null}
            {elements.length ? (
              <fieldset
                className="presentation-desktop-control"
                disabled={readOnly}
              >
                <legend>排列</legend>
                <div className="presentation-arrange-grid">
                  {[
                    "left",
                    "center",
                    "right",
                    "top",
                    "middle",
                    "bottom",
                    "horizontal",
                    "vertical",
                  ].map((mode, i) => (
                    <button key={mode} onClick={() => arrange(mode)}>
                      {
                        [
                          "左对齐",
                          "水平居中",
                          "右对齐",
                          "顶部对齐",
                          "垂直居中",
                          "底部对齐",
                          "水平分布",
                          "垂直分布",
                        ][i]
                      }
                    </button>
                  ))}
                </div>
                <div className="presentation-arrange-grid">
                  {["front", "forward", "backward", "back"].map((mode, i) => (
                    <button key={mode} onClick={() => order(mode)}>
                      {["置于顶层", "上移一层", "下移一层", "置于底层"][i]}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
