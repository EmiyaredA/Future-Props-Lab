import type { Editor } from "@tiptap/react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { PresentationMenu } from "./PresentationMenu";
import { useSelectionFormat } from "./useSelectionFormat";
import type { SlideElement, TextRun } from "./types";
import { listAttributes, listOptions, type ListType } from "./paragraphLists";

export function SelectionTextTools({
  element,
  editor,
  patch,
}: {
  element: SlideElement;
  editor: Editor | null;
  patch: (p: Partial<SlideElement>) => void;
}) {
  const { style, format, align, listType, paragraph } = useSelectionFormat(
    element,
    editor,
    patch,
  );
  const decorations = (["bold", "italic", "underline"] as const).map(
    (key, i) => (
      <button
        key={key}
        title={["粗体", "斜体", "下划线"][i]}
        aria-label={["粗体", "斜体", "下划线"][i]}
        aria-pressed={style[key] === undefined ? "mixed" : style[key]}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => format({ [key]: style[key] !== true })}
      >
        {[<b key="b">B</b>, <i key="i">I</i>, <u key="u">U</u>][i]}
      </button>
    ),
  );
  return (
    <>
      <CustomSelect
        ariaLabel="字体"
        value={style.font ?? "mixed"}
        options={[
          { value: "mixed", label: "混合", disabled: true },
          { value: "Microsoft YaHei", label: "微软雅黑" },
          { value: "Arial", label: "Arial" },
          { value: "Consolas", label: "Consolas（等宽）" },
        ]}
        onChange={(font) => format({ font: font as TextRun["font"] })}
      />
      <div className="selection-font-size">
        <button
          className="selection-secondary"
          aria-label="减小字号"
          disabled={style.size === undefined || style.size <= 6}
          onClick={() => format({ size: Math.max(6, (style.size ?? 24) - 1) })}
        >
          −
        </button>
        <input
          aria-label="字号"
          type="number"
          min={6}
          max={240}
          placeholder="混合"
          value={style.size ?? ""}
          onChange={(e) => {
            if (e.target.value)
              format({
                size: Math.max(6, Math.min(240, Number(e.target.value))),
              });
          }}
        />
        <button
          className="selection-secondary"
          aria-label="增大字号"
          disabled={style.size === undefined || style.size >= 240}
          onClick={() =>
            format({ size: Math.min(240, (style.size ?? 24) + 1) })
          }
        >
          +
        </button>
      </div>
      <span className="selection-secondary selection-decorations">
        {decorations}
      </span>
      <CustomColorPicker
        compact
        ariaLabel="文字颜色"
        value={style.color ?? "#000000"}
        mixed={style.color === undefined}
        onChange={(color) => format({ color })}
      />
      <span className="selection-secondary">
        <CustomSelect
          ariaLabel="文字对齐"
          value={align ?? "mixed"}
          options={[
            { value: "mixed", label: "混合", disabled: true },
            { value: "left", label: "左对齐" },
            { value: "center", label: "居中" },
            { value: "right", label: "右对齐" },
          ]}
          onChange={(value) =>
            paragraph({ align: value as "left" | "center" | "right" })
          }
        />
      </span>
      <CustomSelect
        ariaLabel="列表类型"
        className="selection-secondary"
        value={listType ?? "mixed"}
        options={[
          { value: "mixed", label: "混合", disabled: true },
          ...listOptions,
        ]}
        onChange={(value) => paragraph(listAttributes(value as ListType))}
      />
      <PresentationMenu
        className="selection-compact-only"
        label="更多文字格式"
        actions={[
          ...(["bold", "italic", "underline"] as const).map((key, i) => ({
            label: `${style[key] === true ? "取消" : ""}${["粗体", "斜体", "下划线"][i]}`,
            onSelect: () => format({ [key]: style[key] !== true }),
          })),
          ...(["left", "center", "right"] as const).map((value, i) => ({
            label: ["左对齐", "居中", "右对齐"][i],
            onSelect: () => paragraph({ align: value }),
          })),
          ...listOptions.map(({ value, label }) => ({
            label,
            onSelect: () => paragraph(listAttributes(value as ListType)),
          })),
        ]}
      >
        Aa
      </PresentationMenu>
    </>
  );
}
