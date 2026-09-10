import type { Editor } from "@tiptap/react";
import { Ellipsis, LockKeyhole, SlidersHorizontal, Layers } from "lucide-react";
import { PresentationMenu } from "./PresentationMenu";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { SelectionTextTools } from "./SelectionTextTools";
import { SelectionMediaTools, type MediaActions } from "./SelectionMediaTools";
import type { SlideElement } from "./types";

export type SelectionActions = {
  patch: (p: Partial<SlideElement>) => void;
  duplicate: () => void;
  remove: () => void;
  arrange: (mode: string) => void;
  order: (mode: string) => void;
  inspect: () => void;
  media?: MediaActions;
};
export function SelectionToolbar({
  elements,
  editor,
  actions,
  exit,
}: {
  elements: SlideElement[];
  editor: Editor | null;
  actions: SelectionActions;
  exit: () => void;
}) {
  const element = elements.length === 1 ? elements[0] : undefined;
  const locked = elements.every((e) => e.locked);
  return (
    <div
      role="toolbar"
      aria-label="所选元素工具栏"
      className="presentation-selection-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (
          event.defaultPrevented ||
          (event.target as HTMLElement).closest(
            '[role="menu"],[role="listbox"],[role="dialog"]',
          )
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          exit();
        }
        if (
          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) &&
          !(event.target instanceof HTMLInputElement)
        ) {
          event.preventDefault();
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled)",
            ),
          ).filter(
            (e) =>
              e.getClientRects().length &&
              !e.closest('[role="menu"],[role="listbox"],[role="dialog"]'),
          );
          const index = buttons.indexOf(event.target as HTMLElement);
          buttons[
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index +
                    (event.key === "ArrowLeft" ? -1 : 1) +
                    buttons.length) %
                  buttons.length
          ]?.focus();
        }
      }}
    >
      {locked ? (
        <button onClick={() => actions.patch({ locked: false })}>
          <LockKeyhole size={16} />
          解锁元素
        </button>
      ) : (
        <>
          {element?.kind === "text" ? (
            <SelectionTextTools
              element={element}
              editor={editor}
              patch={actions.patch}
            />
          ) : element?.kind === "image" || element?.kind === "vector" ? (
            <SelectionMediaTools
              element={element}
              patch={actions.patch}
              actions={actions.media}
            />
          ) : element ? (
            <>
              {element.kind !== "line" && (
                <CustomColorPicker
                  compact
                  ariaLabel="填充颜色"
                  value={element.fill}
                  onChange={(fill) => actions.patch({ fill })}
                />
              )}
              <CustomColorPicker
                compact
                ariaLabel="描边颜色"
                value={element.stroke}
                onChange={(stroke) => actions.patch({ stroke })}
              />
              <label className="selection-stroke">
                <input
                  aria-label="描边宽度"
                  type="number"
                  min={0}
                  max={30}
                  step={0.25}
                  value={Math.round(element.stroke_width * 100) / 100}
                  onChange={(e) => {
                    if (e.target.value)
                      actions.patch({
                        stroke_width: Math.min(
                          30,
                          Math.max(0, Number(e.target.value)),
                        ),
                      });
                  }}
                />
                <span>px</span>
              </label>
              <CustomSelect
                ariaLabel="描边样式"
                value={element.stroke_dash ?? "solid"}
                options={[
                  { value: "solid", label: "── 实线" },
                  { value: "dash", label: "虚线" },
                  { value: "dot", label: "点线" },
                ]}
                onChange={(value) =>
                  actions.patch({
                    stroke_dash: value as SlideElement["stroke_dash"],
                  })
                }
              />
              {element.kind === "line" && (
                <PresentationMenu
                  label="箭头设置"
                  actions={(["start_arrow", "end_arrow"] as const).flatMap(
                    (key, i) =>
                      (["none", "triangle", "open", "circle"] as const).map(
                        (value) => ({
                          label: `${i ? "终点" : "起点"}：${{ none: "无箭头", triangle: "三角箭头", open: "开放箭头", circle: "圆点" }[value]}`,
                          onSelect: () => actions.patch({ [key]: value }),
                        }),
                      ),
                  )}
                >
                  ↗
                </PresentationMenu>
              )}
            </>
          ) : (
            <>
              <span className="selection-count">{elements.length} 个元素</span>
              <PresentationMenu
                label="对齐所选元素"
                actions={[
                  "left",
                  "center",
                  "right",
                  "top",
                  "middle",
                  "bottom",
                  "horizontal",
                  "vertical",
                ].map((mode, i) => ({
                  label: [
                    "左对齐",
                    "水平居中",
                    "右对齐",
                    "顶部对齐",
                    "垂直居中",
                    "底部对齐",
                    "水平分布",
                    "垂直分布",
                  ][i],
                  disabled:
                    i > 5 && elements.filter((e) => !e.locked).length < 3,
                  onSelect: () => actions.arrange(mode),
                }))}
              >
                对齐
              </PresentationMenu>
              <PresentationMenu
                label="调整层级"
                actions={["front", "forward", "backward", "back"].map(
                  (mode, i) => ({
                    label: ["置于顶层", "上移一层", "下移一层", "置于底层"][i],
                    onSelect: () => actions.order(mode),
                  }),
                )}
              >
                <Layers size={16} />
              </PresentationMenu>
            </>
          )}
          <PresentationMenu
            label="更多元素操作"
            actions={[
              ...(actions.media &&
              (element?.kind === "image" || element?.kind === "vector")
                ? [
                    { label: "下载原图", onSelect: actions.media.download },
                    { label: "预览原图", onSelect: actions.media.preview },
                    {
                      label: "水平翻转",
                      onSelect: () =>
                        actions.patch({ flip_x: !element.flip_x }),
                    },
                    {
                      label: "垂直翻转",
                      onSelect: () =>
                        actions.patch({ flip_y: !element.flip_y }),
                    },
                  ]
                : []),
              { label: "复制元素", onSelect: actions.duplicate },
              { label: "删除元素", danger: true, onSelect: actions.remove },
              {
                label: "锁定元素",
                onSelect: () => actions.patch({ locked: true }),
              },
            ]}
          >
            <Ellipsis size={18} />
          </PresentationMenu>
          <button
            className="selection-secondary"
            title="更多设置"
            aria-label="更多设置"
            onClick={actions.inspect}
          >
            <SlidersHorizontal size={17} />
          </button>
        </>
      )}
    </div>
  );
}
