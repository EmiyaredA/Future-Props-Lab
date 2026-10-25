import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { SlidePreview } from "../SlideSurface";
import type { NavigationGuard } from "../types";
import { StyleControls } from "./StyleControls";
import { createTemplate, saveTemplate, getTemplate } from "./api";
import {
  defaultDefinition,
  templatePreview,
  pageTypes,
  type Definition,
  type PageType,
  type Template,
} from "./model";

export function TemplateDesigner({
  initial,
  onClose,
  onSaved,
  registerNavigationGuard,
  readOnly,
}: {
  initial: Template | null;
  onClose: () => void;
  onSaved: (t: Template) => void;
  registerNavigationGuard?: NavigationGuard;
  readOnly: boolean;
}) {
  const [saved, setSaved] = useState(initial),
    [title, setTitle] = useState(initial?.title ?? "技术汇报模板");
  const [definition, setDefinition] = useState<Definition>(
    () => (initial?.definition ?? defaultDefinition()) as Definition,
  );
  const [pageType, setPageType] = useState<PageType>("content"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [leave, setLeave] = useState<(() => void) | null>(null),
    [conflict, setConflict] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const dirty =
    !saved ||
    title !== saved.title ||
    JSON.stringify(definition) !== JSON.stringify(saved.definition);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    registerNavigationGuard?.((proceed) => {
      if (!dirtyRef.current) return false;
      setLeave(() => proceed);
      return true;
    });
    return () => registerNavigationGuard?.(null);
  }, [registerNavigationGuard]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, []);
  const preview = templatePreview(definition, pageType);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const result = saved
        ? await saveTemplate(saved.id, title, definition, saved.revision)
        : await createTemplate(title, definition);
      setSaved(result);
      setConflict(false);
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setConflict(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="master-designer">
      <header className="master-header">
        <button
          className="icon-btn"
          aria-label="返回模板库"
          onClick={() => (dirty ? setLeave(() => onClose) : onClose())}
        >
          <ArrowLeft />
        </button>
        <div>
          <small>模板设计器 · 当前 Workspace</small>
          <input
            aria-label="模板名称"
            maxLength={120}
            value={title}
            readOnly={readOnly || busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <span>{dirty ? "未保存" : "已保存"}</span>
        {!readOnly && (
          <button
            className="btn btn-primary"
            disabled={busy || mediaBusy || !title.trim()}
            onClick={() => void save()}
          >
            <Save size={16} />
            {busy ? "正在保存…" : "保存模板"}
          </button>
        )}
      </header>
      {error && (
        <div role="alert" className="master-feedback">
          {error}
          {conflict && saved && (
            <button
              className="btn"
              onClick={() =>
                void getTemplate(saved.id).then((t) => {
                  setSaved(t);
                  setTitle(t.title);
                  setDefinition(t.definition as Definition);
                  setError("");
                  setConflict(false);
                })
              }
            >
              重新载入服务端版本（放弃本地修改）
            </button>
          )}
        </div>
      )}
      <div className="master-designer-body">
        <aside className="master-page-types">
          <h3>页面类型</h3>
          <p>同一模板，五种表达</p>
          {pageTypes.map((p) => (
            <button
              key={p.value}
              aria-pressed={pageType === p.value}
              onClick={() => setPageType(p.value)}
            >
              <span>{String(pageTypes.indexOf(p) + 1).padStart(2, "0")}</span>
              {p.label}
            </button>
          ))}
          <div className="master-tip">
            模板定义全稿规范。已绑定文稿保留快照，需要预览后应用更新。
          </div>
        </aside>
        <main className="master-preview">
          <div className="master-preview-caption">
            {pageTypes.find((p) => p.value === pageType)?.label}预览 ·{" "}
            {definition.width} × {definition.height}
          </div>
          <SlidePreview slide={preview.slides[0]} size={preview} />
          <div className="master-page-strip">
            {pageTypes.map((p) => {
              const d = templatePreview(definition, p.value);
              return (
                <button
                  key={p.value}
                  aria-label={`预览${p.label}`}
                  aria-pressed={pageType === p.value}
                  onClick={() => setPageType(p.value)}
                >
                  <SlidePreview slide={d.slides[0]} size={d} />
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>
        </main>
        <fieldset className="master-properties" disabled={readOnly || busy}>
          <legend className="sr-only">模板全局配置</legend>
          <StyleControls
            onBusyChange={setMediaBusy}
            definition={definition}
            onChange={setDefinition}
            pageType={pageType}
          />
        </fieldset>
      </div>
      <ConfirmDialog
        open={!!leave}
        title="离开模板设计器？"
        description="尚未保存的模板修改将被丢弃。"
        confirmLabel="放弃修改并离开"
        onCancel={() => setLeave(null)}
        onConfirm={() => {
          const next = leave;
          setLeave(null);
          next?.();
        }}
      />
    </div>
  );
}
