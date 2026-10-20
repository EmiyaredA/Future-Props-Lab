import { containDialogComposition } from "./dialogKeyboard";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import {
  codeLanguages,
  codePalettes,
  codeSource,
  highlightCode,
  type CodePalette,
} from "./codeHighlight";
import type { Paragraph, SlideElement } from "./types";
import type { Fragment } from "./scene/model";
import { codeBlock } from "./codeBlock";
import "./code-highlight.css";

export default function CodeHighlightDialog({
  element,
  onApply,
  onClose,
  onInsert,
}: {
  element?: SlideElement;
  onApply?: (paragraphs: Paragraph[]) => void;
  onInsert?: (fragment: Fragment) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState(() =>
    element
      ? codeSource(element.paragraphs)
      : '{\n  "status": "claimed",\n  "message": "已接单",\n  "count": 3\n}',
  );
  const [language, setLanguage] = useState("json");
  const [palette, setPalette] = useState<CodePalette>("light");
  const root = useDrawerFocus<HTMLDivElement>(onClose, true, false);
  const [insertSize, setInsertSize] = useState("20");
  const size = element?.paragraphs[0]?.runs[0]?.size ?? Number(insertSize);
  const lineHeight = element?.paragraphs[0]?.line_height ?? 1.3;
  const result = useMemo(() => {
    try {
      const paragraphs = highlightCode(
        source,
        language,
        palette,
        size,
        lineHeight,
      );
      if (!element) codeBlock(paragraphs, language, palette);
      return {
        paragraphs,
        error: "",
      };
    } catch (e) {
      return {
        paragraphs: null,
        error: e instanceof Error ? e.message : "代码高亮失败",
      };
    }
  }, [source, language, palette, size, lineHeight, element]);
  const neededHeight =
    16 + (result.paragraphs?.length ?? 0) * size * lineHeight;
  const title = element ? "代码高亮" : "插入代码块";
  return createPortal(
    <div className="presentation-modal-backdrop">
      <div
        onKeyDownCapture={containDialogComposition}
        ref={root}
        className="presentation-dialog presentation-dialog-large presentation-code-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h3>{title}</h3>
          <button
            className="icon-btn"
            aria-label={`关闭${title}`}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="presentation-dialog-body">
          <div className="presentation-code-settings">
            <label>
              代码语言
              <CustomSelect
                ariaLabel="高亮语言"
                value={language}
                options={codeLanguages}
                onChange={setLanguage}
              />
            </label>
            {!element && (
              <label>
                代码字号
                <CustomSelect
                  ariaLabel="代码字号"
                  value={insertSize}
                  options={[14, 16, 18, 20, 24, 28].map((value) => ({
                    value: String(value),
                    label: `${value} px`,
                  }))}
                  onChange={setInsertSize}
                />
              </label>
            )}
            <label>
              文字配色
              <CustomSelect
                ariaLabel="高亮配色"
                value={palette}
                options={[
                  { value: "light", label: "适合浅色背景" },
                  { value: "dark", label: "适合深色背景" },
                ]}
                onChange={(value) => setPalette(value as CodePalette)}
              />
            </label>
          </div>
          <p>
            {element
              ? "按代码所在区域的底色选择配色。应用后仍可编辑文字，修改代码后可再次应用高亮。背景和文本框尺寸保持原样。"
              : "插入包含背景、语言标签和高亮代码的可编辑内容块。可整体移动，进入分组后分别编辑文字和外观。"}
          </p>
          <div className="presentation-code-columns">
            <label>
              代码内容
              <textarea
                aria-label="代码内容"
                spellCheck={false}
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </label>
            <div>
              <h4>高亮预览</h4>
              <div
                className="presentation-code-preview"
                aria-label="代码高亮预览"
                style={{
                  background: codePalettes[palette].background,
                  color: codePalettes[palette].text,
                }}
              >
                {result.paragraphs?.map((p, index) => (
                  <div key={index}>
                    {p.runs.map((run, j) => (
                      <span key={j} style={{ color: run.color }}>
                        {run.text}
                      </span>
                    ))}
                    {p.runs.every((r) => !r.text) ? <br /> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {result.error && <p role="alert">{result.error}</p>}
          {!result.error && element && neededHeight > element.height + 1 && (
            <p role="status">
              当前字号需要约 {Math.ceil(neededHeight)} px
              高度；应用后请加高文本框或拆分代码，并检查长行是否越界。
            </p>
          )}
        </div>
        <footer>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!result.paragraphs || !source.trim()}
            onClick={() => {
              if (result.paragraphs) {
                if (element) onApply?.(result.paragraphs);
                else
                  onInsert?.(codeBlock(result.paragraphs, language, palette));
                onClose();
              }
            }}
          >
            {element ? "应用高亮" : "插入代码块"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
