import { useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { SlidePreview } from "../SlideSurface";
import type { PresentationSession } from "../editor/usePresentationSession";
import { applyChange, previewChange } from "./api";
import {
  pageTypes,
  type Change,
  type Preview,
  type Template,
  type PageType,
} from "./model";
export function LayoutApplicationPanel({
  session,
  target,
  readOnly,
}: {
  session: PresentationSession;
  target: Template;
  readOnly: boolean;
}) {
  const deck = session.draft.draft.document;
  const [pages, setPages] = useState([session.slide.id]),
    [type, setType] = useState<PageType>(session.slide.page_type ?? "content"),
    [textStyle, setTextStyle] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      deck.slides.flatMap(
        (s) =>
          s.layout_source?.objects?.map((o) => [
            `${s.id}:${o.element_id}`,
            o.default_id,
          ]) ?? [],
      ),
    ),
  );
  const [preview, setPreview] = useState<Preview | null>(null),
    [request, setRequest] = useState<Change | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const defaults = target.definition.layouts?.[type]?.defaults?.elements ?? [];
  const invalidate = () => {
    setPreview(null);
    setRequest(null);
  };
  const run = async (apply = false) => {
    setBusy(true);
    setError("");
    try {
      if (apply && preview && request) {
        if (session.draft.isDirty()) throw new Error("文稿已修改，请重新预览");
        const saved = await applyChange(
          session.projectId,
          request,
          preview.preview_token,
        );
        session.draft.acceptExternal(saved);
        invalidate();
        return;
      }
      const saved = await session.draft.flush();
      const layout_mappings = deck.slides
        .filter((s) => pages.includes(s.id))
        .map((s) => ({
          slide_id: s.id,
          page_type: type,
          objects: s.elements.flatMap((e) => {
            const id = mapping[`${s.id}:${e.id}`];
            return id ? [{ element_id: e.id, default_id: id }] : [];
          }),
        }));
      if (
        !layout_mappings.length ||
        layout_mappings.some((m) => !m.objects.length)
      )
        throw new Error("请为每个选中页面明确映射至少一个对象");
      const body: Change = {
        action: "layout",
        expected_revision: saved.revision,
        template_id: target.id,
        template_revision: target.revision,
        layout_mappings,
        apply_text_style: textStyle,
      };
      const result = await previewChange(saved.id, body);
      setRequest(body);
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "套版失败");
      invalidate();
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="master-document-rules">
      <summary>正文版式 · 预览后应用到指定页</summary>
      <fieldset disabled={readOnly || busy}>
        <p>只调整明确映射对象；未映射正文保持原样，不插入示例文案。</p>
        <CustomSelect
          ariaLabel="正文目标页型"
          value={type}
          options={pageTypes}
          onChange={(v) => {
            setType(v as PageType);
            invalidate();
          }}
        />
        <div className="master-layout-page-list">
          {deck.slides.map((s, i) => (
            <label key={s.id} className="master-check">
              <input
                type="checkbox"
                checked={pages.includes(s.id)}
                onChange={() => {
                  setPages((p) =>
                    p.includes(s.id)
                      ? p.filter((id) => id !== s.id)
                      : [...p, s.id],
                  );
                  invalidate();
                }}
              />
              {i + 1}. {s.title || "未命名页面"}
            </label>
          ))}
        </div>
        {deck.slides
          .filter((s) => pages.includes(s.id))
          .map((s, i) => (
            <details key={s.id} open={i === 0}>
              <summary>{s.title || s.id} · 对象映射</summary>
              {s.elements.map((e) => (
                <label className="master-field" key={e.id}>
                  <span>
                    {e.name ||
                      e.paragraphs
                        .flatMap((p) => p.runs.map((r) => r.text))
                        .join("")
                        .slice(0, 24) ||
                      e.kind}
                  </span>
                  <CustomSelect
                    ariaLabel={`映射 ${s.id} ${e.id}`}
                    value={mapping[`${s.id}:${e.id}`] ?? ""}
                    options={[
                      { value: "", label: "保持原样" },
                      ...defaults
                        .filter((d) => d.kind === e.kind)
                        .map((d) => ({ value: d.id, label: d.name || d.id })),
                    ]}
                    onChange={(value) => {
                      setMapping((m) => ({ ...m, [`${s.id}:${e.id}`]: value }));
                      invalidate();
                    }}
                  />
                </label>
              ))}
            </details>
          ))}
        <label className="master-check">
          <input
            type="checkbox"
            checked={textStyle}
            onChange={() => {
              setTextStyle((v) => !v);
              invalidate();
            }}
          />
          同时同步文字样式（默认关闭）
        </label>
        <button className="btn" onClick={() => void run()}>
          预览指定页版式
        </button>
        {error && <p role="alert">{error}</p>}
        {preview && (
          <div className="master-layout-result">
            <p>
              文稿版本 {preview.document_revision} · 模板版本{" "}
              {preview.template_revision} · 影响{" "}
              {preview.affected_slides.length} 页
            </p>
            {preview.document.slides
              .filter((s) => pages.includes(s.id))
              .map((s) => (
                <div key={s.id}>
                  <SlidePreview slide={s} size={preview.document} />
                  <strong>{s.title}</strong>
                </div>
              ))}
            <ul>
              {preview.issues.map((issue, i) => (
                <li key={i}>{String(issue.message ?? issue.code)}</li>
              ))}
            </ul>
            <button className="btn btn-primary" onClick={() => void run(true)}>
              确认应用指定页版式
            </button>
          </div>
        )}
      </fieldset>
    </details>
  );
}
