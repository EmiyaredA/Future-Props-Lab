import { slideTheme } from "./slideTheme";
import { lazy, Suspense, useId, useState, type ReactNode } from "react";
import { LockKeyhole, UnlockKeyhole, RotateCcw } from "lucide-react";
import { useInspectorResize } from "./useInspectorResize";
import { MediaAppearance } from "./MediaAppearance";
import {
  layoutControls,
  type LayoutControls,
  type LayoutCommand,
} from "./layoutObjects";
import { InspectorArrange } from "./InspectorArrange";
import "./presentation-inspector.css";
import type { Editor } from "@tiptap/react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import type { Slide, SlideElement } from "./types";
import { NumberField } from "./PresentationNumberField";
import { PresentationShapeSettings } from "./PresentationShapeSettings";
import { useSelectionFormat } from "./useSelectionFormat";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { listAttributes, listOptions, type ListType } from "./paragraphLists";

const CodeHighlightDialog = lazy(() => import("./CodeHighlightDialog"));

export function PresentationInspector({
  slide,
  selected,
  patch,
  background,
  editor,
  arrange,
  layout,
  order,
  editText,
  readOnly,
  imageVersionPanel,
  onStyle,
  styleDisabled = false,
}: {
  slide: Slide;
  selected: string[];
  patch: (patch: Partial<SlideElement>) => void;
  background: (color: string) => void;
  editor: Editor | null;
  arrange: (mode: LayoutCommand) => void;
  layout?: LayoutControls;
  order: (mode: string) => void;
  editText: () => void;
  readOnly: boolean;
  imageVersionPanel?: ReactNode;
  onStyle?: () => void;
  styleDisabled?: boolean;
}) {
  const resize = useInspectorResize();
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
  const colors = [
    slideTheme.navy,
    slideTheme.white,
    slideTheme.fill,
    slideTheme.blue,
    slideTheme.teal,
  ];
  const disabled = readOnly || !!element?.locked;
  const [codeTarget, setCodeTarget] = useState<string | null>(null);
  const { lineHeight, listType, paragraph } = useSelectionFormat(
    element ?? undefined,
    editor,
    patch,
  );
  return (
    <aside
      ref={resize.ref}
      className={`presentation-inspector${resize.dragging ? " is-resizing" : ""}`}
      style={{ width: resize.width }}
      aria-label="格式面板"
    >
      <div
        className="presentation-inspector-resize"
        aria-controls={`${tabId}-panel`}
        {...resize.separator}
      >
        <span />
      </div>
      <div className="presentation-inspector-header">
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
        <button
          className="presentation-inspector-reset"
          onClick={resize.reset}
          title="恢复默认面板宽度"
          aria-label="恢复默认面板宽度"
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div
        className="presentation-inspector-content"
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-${tab}`}
      >
        <div className="presentation-inspector-heading">
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
          {tab === "elements" && elements.length > 0 && (
            <button
              className="presentation-lock-toggle presentation-desktop-control"
              title={elements.every((e) => e.locked) ? "解锁元素" : "锁定元素"}
              aria-label={
                elements.every((e) => e.locked) ? "解锁元素" : "锁定元素"
              }
              aria-pressed={elements.every((e) => e.locked)}
              disabled={readOnly}
              onClick={() =>
                patch({ locked: !elements.every((e) => e.locked) })
              }
            >
              {elements.every((e) => e.locked) ? (
                <LockKeyhole size={16} />
              ) : (
                <UnlockKeyhole size={16} />
              )}
            </button>
          )}
        </div>
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
            {onStyle && (
              <button
                className="btn presentation-theme-button"
                disabled={readOnly || styleDisabled}
                onClick={onStyle}
              >
                应用蓝青风格
              </button>
            )}
            {imageVersionPanel}
          </>
        ) : null}
        {tab === "elements" && !elements.length && (
          <p className="muted">选择元素调整样式，双击文本框编辑文字。</p>
        )}
        {tab === "elements" && (
          <>
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
                        ...(element.kind === "image" ||
                        element.kind === "vector"
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
                        ...(element.kind === "image" ||
                        element.kind === "vector"
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
                    <button
                      className="btn"
                      disabled={disabled || !!editor}
                      onClick={() => setCodeTarget(element.id)}
                    >
                      代码高亮
                    </button>
                    <fieldset
                      disabled={disabled}
                      className="presentation-desktop-control"
                    >
                      <NumberField
                        label="行距"
                        value={lineHeight ?? 1.3}
                        mixed={lineHeight === undefined}
                        min={1}
                        max={3}
                        step={0.1}
                        onChange={(line_height) => paragraph({ line_height })}
                      />
                      <CustomSelect
                        ariaLabel="列表类型"
                        value={listType ?? "mixed"}
                        options={[
                          { value: "mixed", label: "混合", disabled: true },
                          ...listOptions,
                        ]}
                        disabled={disabled}
                        onChange={(value) =>
                          paragraph(listAttributes(value as ListType))
                        }
                      />
                    </fieldset>
                  </>
                ) : element.kind === "image" ? (
                  <>
                    <MediaAppearance
                      element={element}
                      patch={patch}
                      disabled={disabled}
                    />
                    <fieldset className="presentation-crop" disabled={disabled}>
                      <legend>矩形裁剪（%）</legend>
                      <p className="muted">等比填充，调整各边的裁剪范围。</p>
                      <div className="presentation-crop-grid">
                        {(["left", "top", "right", "bottom"] as const).map(
                          (side, i) => (
                            <NumberField
                              key={side}
                              label={
                                [
                                  "裁剪左侧",
                                  "裁剪顶部",
                                  "裁剪右侧",
                                  "裁剪底部",
                                ][i]
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
                                  crop: {
                                    ...element.crop,
                                    [side]: value / 100,
                                  },
                                })
                              }
                            />
                          ),
                        )}
                      </div>
                      <button
                        className="btn presentation-crop-reset"
                        onClick={() =>
                          patch({
                            crop: { left: 0, right: 0, top: 0, bottom: 0 },
                          })
                        }
                      >
                        <RotateCcw size={13} aria-hidden="true" /> 重置裁剪
                      </button>
                    </fieldset>
                  </>
                ) : element.kind === "vector" ? (
                  <MediaAppearance
                    element={element}
                    patch={patch}
                    disabled={disabled}
                  />
                ) : (
                  <PresentationShapeSettings
                    element={element}
                    advancedOnly
                    patch={patch}
                    disabled={disabled}
                  />
                )}
              </>
            ) : null}
            {elements.length ? (
              <InspectorArrange
                disabled={readOnly}
                layout={
                  layout ?? layoutControls(slide, selected, null, readOnly)
                }
                arrange={arrange}
                order={order}
              />
            ) : null}
          </>
        )}
      </div>
      {codeTarget && element?.id === codeTarget && !disabled && !editor && (
        <Suspense fallback={<p role="status">正在加载代码高亮…</p>}>
          <CodeHighlightDialog
            key={codeTarget}
            element={element}
            onApply={(paragraphs) => patch({ paragraphs })}
            onClose={() => setCodeTarget(null)}
          />
        </Suspense>
      )}
    </aside>
  );
}
