import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { NumberField } from "../../PresentationNumberField";
import {
  containDialogComposition,
  keepDialogEscapeLocal,
  useDialogReturnFocus,
} from "../../dialogKeyboard";
import { uploadImage } from "../../api";
import type { PageSize, SlideElement } from "../../types";
import { newObject } from "../objectDefaults";
import {
  cosineFormula,
  formulaTemplates,
  insertFormulaTemplate,
} from "./formulaTemplates";
import { formulaGeometry } from "./formulaGeometry";
import { formulaImage, useFormulaPreview } from "./useFormulaPreview";
import "./formula.css";

function TemplateImage({ latex }: { latex: string }) {
  const preview = useFormulaPreview({ latex, color: "#17334A", size: 24 }, 0);
  return preview.drawing ? (
    <img alt="" src={formulaImage(preview.drawing.svg)} />
  ) : (
    <span className="muted" aria-hidden="true">
      {preview.error ? "预览不可用" : "…"}
    </span>
  );
}

export default function FormulaDialog({
  initial,
  pageSize,
  onApply,
  onClose,
}: {
  initial?: SlideElement;
  pageSize: PageSize;
  onApply: (element: SlideElement) => void;
  onClose: () => void;
}) {
  const returnFocus = useDialogReturnFocus();
  const [element, setElement] = useState(() =>
    structuredClone(initial ?? newObject("formula")),
  );
  const formula = element.formula!;
  const [composing, setComposing] = useState(false);
  const preview = useFormulaPreview(formula, 200, composing);
  const original = useFormulaPreview(initial?.formula ?? null, 0);
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const cancelled = useRef(false),
    submitting = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);
  useEffect(() => {
    if (!pendingSelection.current || !input.current) return;
    input.current.focus();
    const { start, end } = pendingSelection.current;
    input.current.setSelectionRange(start, end);
    selection.current = { start, end };
    pendingSelection.current = null;
  }, [formula.latex]);
  const change = (values: Partial<typeof formula>) => {
    setError("");
    setElement((e) => ({ ...e, formula: { ...e.formula!, ...values } }));
  };
  const replaceSource = (latex: string, start: number, end: number) => {
    pendingSelection.current = { start, end };
    change({ latex });
    if (latex === formula.latex && input.current) {
      input.current.focus();
      input.current.setSelectionRange(start, end);
      selection.current = { start, end };
      pendingSelection.current = null;
    }
  };
  const close = () => {
    cancelled.current = true;
    onClose();
  };
  const ready =
    !!preview.drawing && (!initial || !!original.drawing || !!original.error);
  const apply = async () => {
    if (!ready || !preview.drawing || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const geometry = formulaGeometry(
        element,
        preview.drawing,
        pageSize,
        initial ? { element: initial, drawing: original.drawing } : undefined,
      );
      const asset = await uploadImage(
        new File([preview.drawing.svg], "公式.svg", { type: "image/svg+xml" }),
      );
      if (!cancelled.current) {
        onApply({ ...element, ...geometry, asset_id: asset.id });
        close();
      }
    } catch (e) {
      if (!cancelled.current)
        setError(e instanceof Error ? e.message : "无法应用公式，请重试");
    } finally {
      submitting.current = false;
      if (!cancelled.current) setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="presentation-modal-backdrop" />
        <Dialog.Content
          className="presentation-dialog presentation-dialog-floating presentation-formula-dialog"
          data-presentation-history="local"
          onCloseAutoFocus={returnFocus}
          onEscapeKeyDown={keepDialogEscapeLocal}
          onKeyDownCapture={containDialogComposition}
        >
          <header>
            <div>
              <Dialog.Title>{initial ? "编辑公式" : "插入公式"}</Dialog.Title>
              <Dialog.Description>选择模板，再编辑你的公式</Dialog.Description>
            </div>
            <button
              className="icon-btn"
              aria-label="关闭公式编辑"
              onClick={close}
            >
              <X size={18} />
            </button>
          </header>
          <div className="presentation-dialog-body">
            <fieldset disabled={busy} className="presentation-formula-layout">
              <aside
                className="presentation-formula-templates"
                aria-label="公式模板"
              >
                <h3>公式模板</h3>
                <p className="muted">基础结构</p>
                <div className="presentation-formula-grid">
                  {formulaTemplates.map((template) => (
                    <button
                      className="presentation-formula-template"
                      key={template.label}
                      aria-label={`插入${template.label}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const result = insertFormulaTemplate(
                          formula.latex,
                          selection.current.start,
                          selection.current.end,
                          template.wrap,
                        );
                        if (result.latex.length > 20000) {
                          setError("公式最多 20000 个字符，请缩短后再插入");
                          return;
                        }
                        replaceSource(result.latex, result.start, result.end);
                      }}
                    >
                      <TemplateImage latex={template.sample} />
                      <span>{template.label}</span>
                    </button>
                  ))}
                </div>
                <p className="muted">常用公式</p>
                <button
                  className="presentation-formula-template presentation-formula-preset"
                  aria-label="余弦相似度"
                  aria-pressed={formula.latex === cosineFormula}
                  onClick={() => {
                    replaceSource(cosineFormula, 0, cosineFormula.length);
                  }}
                >
                  <TemplateImage latex={cosineFormula} />
                  <span>余弦相似度</span>
                </button>
              </aside>
              <section
                className="presentation-formula-content"
                aria-label="公式内容"
              >
                <h3>实时预览</h3>
                <div
                  className="presentation-formula-preview"
                  aria-busy={!preview.drawing && !preview.error}
                >
                  {preview.drawing ? (
                    <img
                      alt="公式实时预览"
                      src={formulaImage(preview.drawing.svg)}
                      style={{
                        width: preview.drawing.width,
                        height: preview.drawing.height,
                      }}
                    />
                  ) : (
                    <p role="status">
                      {preview.error ??
                        (composing
                          ? "输入完成后更新预览"
                          : "正在生成公式预览…")}
                    </p>
                  )}
                </div>
                <label className="presentation-formula-source">
                  LaTeX 公式
                  <textarea
                    ref={input}
                    aria-label="LaTeX 公式"
                    value={formula.latex}
                    maxLength={20000}
                    spellCheck={false}
                    onChange={(e) => change({ latex: e.target.value })}
                    onSelect={(e) => {
                      selection.current = {
                        start: e.currentTarget.selectionStart,
                        end: e.currentTarget.selectionEnd,
                      };
                    }}
                    onCompositionStart={() => setComposing(true)}
                    onCompositionEnd={() => setComposing(false)}
                  />
                </label>
                <div className="presentation-formula-settings">
                  <label>
                    <span>颜色</span>
                    <CustomColorPicker
                      ariaLabel="公式颜色"
                      value={formula.color}
                      onChange={(color) => change({ color })}
                    />
                  </label>
                  <NumberField
                    label="公式字号"
                    value={formula.size}
                    min={6}
                    max={240}
                    onChange={(size) => change({ size })}
                  />
                </div>
              </section>
            </fieldset>
            {error && <p role="alert">{error}</p>}
            {original.error && (
              <p className="muted">
                原公式无法解析，修正后将按原对象框调整尺寸。
              </p>
            )}
          </div>
          <footer>
            <p className="muted">插入后可移动、缩放，双击继续编辑</p>
            <button className="btn" onClick={close}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={busy || !ready}
              onClick={() => void apply()}
            >
              {busy ? "正在处理…" : initial ? "应用修改" : "插入公式"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
