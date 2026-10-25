import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, LayoutTemplate } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { SlidePreview } from "../SlideSurface";
import { presentationKeys } from "../queryKeys";
import { newId, newSlide } from "../templates";
import type { PresentationSession } from "../editor/usePresentationSession";
import { StyleControls } from "./StyleControls";
import { TemplateDesigner } from "./TemplateDesigner";
import { editableDefinition } from "./nativeScenes";
import { LayoutApplicationPanel } from "./LayoutApplicationPanel";
import {
  createExample,
  listTemplates,
  previewChange,
  applyChange,
} from "./api";
import {
  effectiveDefinition,
  pageTypes,
  resolveSlide,
  tocOverflow,
  type Definition,
  type Change,
  type Preview,
  type PageType,
} from "./model";

export function DocumentTemplateButton({
  session,
  readOnly,
}: {
  session: PresentationSession;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const root = session.history.root.current;
    const handler = () => setOpen(true);
    root?.addEventListener("presentation-template-edit", handler);
    return () =>
      root?.removeEventListener("presentation-template-edit", handler);
  }, [session.history.root]);
  return (
    <>
      <button
        className="btn"
        onClick={() => setOpen(true)}
        disabled={!!session.cropSession}
      >
        <LayoutTemplate size={16} />
        文稿模板
      </button>
      {open && (
        <DocumentTemplatePanel
          session={session}
          readOnly={readOnly}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function DocumentTemplatePanel({
  session,
  readOnly,
  onClose,
}: {
  session: PresentationSession;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { draft, slide, commit } = session,
    deck = draft.draft.document;
  const root = useDrawerFocus<HTMLDivElement>(onClose, true, false);
  const templates = useQuery({
    queryKey: presentationKeys.templates,
    queryFn: ({ signal }) => listTemplates(signal),
  });
  const [selected, setSelected] = useState(deck.template?.template_id ?? ""),
    [preview, setPreview] = useState<Preview | null>(null),
    [request, setRequest] = useState<Change | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [global, setGlobal] = useState<Definition | null>(null),
    [type, setType] = useState<PageType>(slide.page_type ?? "content"),
    [example, setExample] = useState(false),
    [newChapter, setNewChapter] = useState(false);
  const [layoutEditor, setLayoutEditor] = useState(false);
  const initialChapters = useRef(
    deck.chapters?.length
      ? deck.chapters
      : [
          ...new Set(
            deck.slides.map((s) => s.section).filter((s): s is string => !!s),
          ),
        ].map((title) => ({ id: newId(), title })),
  );
  const [chapters, setChapters] = useState(initialChapters.current);
  const [mappings, setMappings] = useState<NonNullable<Change["mappings"]>>(
    () =>
      deck.slides.map((s) => ({
        slide_id: s.id,
        title: s.title ?? "",
        page_type: s.page_type ?? "content",
        chapter_id:
          s.chapter_id ??
          initialChapters.current.find((c) => c.title === s.section)?.id ??
          null,
        title_element_ids: [],
      })),
  );
  const [mediaBusy, setMediaBusy] = useState(false);
  const running = useRef(false);
  const target = templates.data?.items.find((t) => t.id === selected);
  const effective = effectiveDefinition(deck);
  const current =
    preview?.document ??
    (global && deck.template
      ? { ...deck, template_overrides: { ...global, layouts: global.layouts } }
      : deck);
  const shown =
    current.slides.find((s) => s.id === slide.id) ?? current.slides[0];
  const currentSlide = global ? { ...shown, page_type: type } : shown;
  const updatePage = (values: Partial<typeof slide>) => {
    setPreview(null);
    session.changeSlide((s) => ({ ...s, ...values }));
  };
  const updateChapters = (next: typeof chapters) => {
    setChapters(next);
    if (deck.template)
      commit((d) => ({ ...d, document: { ...d.document, chapters: next } }));
    setPreview(null);
  };
  const work = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      setPreview(null);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const makePreview = (action: Change["action"]) =>
    work(async () => {
      const saved = await draft.flush();
      const body: Change = {
        expected_revision: saved.revision,
        action,
        template_id: target?.id ?? null,
        template_revision: target?.revision ?? null,
        ...(!deck.template ? { mappings, chapters } : {}),
      };
      const result = await previewChange(saved.id, body);
      setRequest(body);
      setPreview(result);
    });
  const saveGlobal = (value: Definition | null = global) => {
    if (!value || !deck.template) return;
    const base =
      value.version === 2
        ? editableDefinition(deck.template.snapshot as Definition)
        : deck.template.snapshot;
    const overrides = {
      ...Object.fromEntries(
        Object.entries(value).filter(
          ([key, value]) =>
            !["version", "width", "height", "layouts"].includes(key) &&
            JSON.stringify(value) !==
              JSON.stringify(base[key as keyof typeof base]),
        ),
      ),
      layouts: Object.fromEntries(
        Object.entries(value.layouts).filter(
          ([key, value]) =>
            JSON.stringify(value) !==
            JSON.stringify(base.layouts?.[key as PageType]),
        ),
      ),
    };
    commit((d) => ({
      ...d,
      document: {
        ...d.document,
        version: value.version === 2 ? 5 : d.document.version,
        template: { ...d.document.template!, snapshot: base },
        template_overrides: overrides,
      },
    }));
    setGlobal(null);
    setPreview(null);
    setLayoutEditor(false);
  };
  if (layoutEditor && effective && deck.template)
    return (
      <div
        className="master-layout-modal"
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="编辑当前文稿模板布局"
      >
        <TemplateDesigner
          initial={{
            id: deck.template.template_id ?? "document",
            title: deck.template.name,
            description: "当前文稿覆盖",
            revision: deck.template.template_revision ?? 0,
            created_at: "",
            updated_at: "",
            definition: effective,
          }}
          onClose={() => setLayoutEditor(false)}
          onSaved={() => {}}
          onSaveDefinition={saveGlobal}
          readOnly={readOnly}
        />
      </div>
    );
  return (
    <div className="presentation-modal-backdrop">
      <div
        className="presentation-dialog master-document-dialog"
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="文稿模板"
      >
        <header>
          <div>
            <h3>文稿模板</h3>
            <p>
              {deck.template
                ? `${deck.template.name} · 使用版本 ${deck.template.template_revision + 1}`
                : "当前文稿未绑定模板"}
            </p>
          </div>
          <button
            className="icon-btn"
            aria-label="关闭文稿模板"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="master-document-body">
          <main className="master-document-preview">
            <SlidePreview
              slide={resolveSlide(current, currentSlide)}
              size={current}
            />
            <p>
              第 {deck.slides.findIndex((s) => s.id === slide.id) + 1} 页 ·
              正文、素材与备注保持原位
            </p>
            {preview && (
              <section className="master-change-summary">
                <h4>变更预览</h4>
                <p>{preview.changes.join("、") || "模板规范相同"}</p>
                <p>
                  影响 {preview.affected_slides.length} 页 · 文稿 revision{" "}
                  {preview.document_revision} · 模板 revision{" "}
                  {preview.template_revision ?? "—"}
                </p>
                {preview.issues.map((issue, i) => (
                  <p key={i} className="master-warning">
                    第{" "}
                    {current.slides.findIndex((s) => s.id === issue.slide_id) +
                      1}{" "}
                    页：{String(issue.message)}
                  </p>
                ))}
              </section>
            )}
          </main>
          <fieldset
            className="master-document-settings"
            disabled={busy || readOnly}
          >
            <legend className="sr-only">绑定和文稿全局配置</legend>
            {error && (
              <p role="alert" className="master-feedback">
                {error}
              </p>
            )}
            {global ? (
              <>
                <div className="master-section-heading">
                  <h4>编辑全稿样式</h4>
                  <button className="btn" onClick={() => setGlobal(null)}>
                    取消
                  </button>
                </div>
                <p>仅影响当前文稿，应用后可一次撤销。</p>
                <CustomSelect
                  ariaLabel="全稿样式预览页型"
                  options={pageTypes}
                  value={type}
                  onChange={(v) => setType(v as PageType)}
                />
                <StyleControls
                  onBusyChange={setMediaBusy}
                  definition={global}
                  onChange={setGlobal}
                  pageType={type}
                />
                <button
                  className="btn btn-primary"
                  disabled={mediaBusy}
                  onClick={() => saveGlobal()}
                >
                  应用全稿样式
                </button>
              </>
            ) : (
              <>
                {deck.template && (
                  <button
                    className="btn master-edit-global"
                    onClick={() => {
                      if (effective?.version === 2) setLayoutEditor(true);
                      else setGlobal(effective);
                      setPreview(null);
                    }}
                  >
                    <LayoutTemplate size={16} />
                    编辑全稿样式
                  </button>
                )}
                {deck.template && (
                  <button className="btn" onClick={() => setLayoutEditor(true)}>
                    编辑模板布局
                  </button>
                )}
                {deck.template && target?.definition.version === 2 && (
                  <LayoutApplicationPanel
                    session={session}
                    target={target}
                    readOnly={readOnly}
                  />
                )}
                <details
                  className="master-document-rules"
                  open={deck.template ? undefined : true}
                >
                  <summary>模板绑定与更新</summary>
                  {templates.isError ? (
                    <button
                      className="btn"
                      onClick={() => void templates.refetch()}
                    >
                      模板加载失败，重试
                    </button>
                  ) : (
                    <CustomSelect
                      ariaLabel="选择文稿模板"
                      value={selected}
                      options={[
                        { value: "", label: "选择模板" },
                        ...(templates.data?.items ?? []).map((t) => ({
                          value: t.id,
                          label: `${t.title} · v${t.revision + 1}`,
                        })),
                      ]}
                      onChange={(value) => {
                        setSelected(value);
                        setPreview(null);
                      }}
                    />
                  )}
                  {deck.template && (
                    <>
                      <button
                        className="btn"
                        onClick={() =>
                          commit((d) => ({
                            ...d,
                            document: { ...d.document, template_overrides: {} },
                          }))
                        }
                      >
                        清除文稿覆盖，恢复跟随快照
                      </button>
                      {!templates.isPending &&
                        !templates.data?.items.some(
                          (t) => t.id === deck.template?.template_id,
                        ) && <p>源模板已删除或不可访问，内嵌快照仍然可用。</p>}
                    </>
                  )}
                  {!deck.template && (
                    <>
                      <p>
                        逐页确认页标题和章节。只转换勾选的文字对象；正文不做自动识别。
                      </p>
                      <fieldset className="master-settings-group">
                        <legend>章节信息</legend>
                        {chapters.map((c) => (
                          <label className="master-field" key={c.id}>
                            章节名称
                            <input
                              aria-label={`章节 ${c.title}`}
                              value={c.title}
                              maxLength={120}
                              onChange={(e) =>
                                updateChapters(
                                  chapters.map((item) =>
                                    item.id === c.id
                                      ? {
                                          ...item,
                                          title: e.target.value || "未命名章节",
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                        ))}
                        <button
                          className="btn"
                          onClick={() => setNewChapter(true)}
                        >
                          添加章节
                        </button>
                      </fieldset>
                      {mappings.map((mapping, index) => {
                        const page = deck.slides.find(
                          (s) => s.id === mapping.slide_id,
                        )!;
                        const patch = (v: Partial<typeof mapping>) => {
                          setMappings((items) =>
                            items.map((item, i) =>
                              i === index ? { ...item, ...v } : item,
                            ),
                          );
                          setPreview(null);
                        };
                        return (
                          <details
                            className="master-settings-group"
                            key={page.id}
                          >
                            <summary>
                              第 {index + 1} 页：{mapping.title || "待确认标题"}
                            </summary>
                            <label className="master-field">
                              页标题
                              <input
                                aria-label={`第 ${index + 1} 页标题`}
                                maxLength={500}
                                value={mapping.title}
                                onChange={(e) =>
                                  patch({ title: e.target.value })
                                }
                              />
                            </label>
                            <CustomSelect
                              ariaLabel={`第 ${index + 1} 页章节`}
                              value={mapping.chapter_id ?? ""}
                              options={[
                                { value: "", label: "不属于章节" },
                                ...chapters.map((c) => ({
                                  value: c.id,
                                  label: c.title,
                                })),
                              ]}
                              onChange={(chapter_id) =>
                                patch({ chapter_id: chapter_id || null })
                              }
                            />
                            <CustomSelect
                              ariaLabel={`第 ${index + 1} 页型`}
                              value={mapping.page_type ?? "content"}
                              options={pageTypes}
                              onChange={(page_type) =>
                                patch({ page_type: page_type as PageType })
                              }
                            />
                            <p>选择转为模板标题的原文字对象：</p>
                            {page.elements
                              .filter((e) => e.kind === "text")
                              .map((element) => (
                                <label
                                  className="master-check"
                                  key={element.id}
                                >
                                  <input
                                    type="checkbox"
                                    checked={mapping.title_element_ids?.includes(
                                      element.id,
                                    )}
                                    onChange={(e) => {
                                      const ids = e.target.checked
                                        ? [
                                            ...(mapping.title_element_ids ??
                                              []),
                                            element.id,
                                          ]
                                        : (
                                            mapping.title_element_ids ?? []
                                          ).filter((id) => id !== element.id);
                                      patch({
                                        title_element_ids: ids,
                                        ...(!mapping.title && e.target.checked
                                          ? {
                                              title: element.paragraphs
                                                .map((p) =>
                                                  p.runs
                                                    .map((r) => r.text)
                                                    .join(""),
                                                )
                                                .join("\n"),
                                            }
                                          : {}),
                                      });
                                    }}
                                  />
                                  {element.paragraphs
                                    .map((p) =>
                                      p.runs.map((r) => r.text).join(""),
                                    )
                                    .join(" / ")
                                    .slice(0, 100)}
                                </label>
                              ))}
                          </details>
                        );
                      })}
                    </>
                  )}
                  <div className="master-actions">
                    <button
                      className="btn btn-primary"
                      disabled={!target}
                      onClick={() =>
                        void makePreview(
                          deck.template?.template_id === selected
                            ? "update"
                            : "bind",
                        )
                      }
                    >
                      {deck.template?.template_id === selected
                        ? "预览模板更新"
                        : "预览套用模板"}
                    </button>
                    {deck.template && (
                      <button
                        className="btn"
                        onClick={() => void makePreview("unbind")}
                      >
                        预览解除绑定
                      </button>
                    )}
                  </div>
                  {preview && request && (
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        void work(async () => {
                          if (draft.isDirty())
                            throw new Error("文稿已修改，请重新预览");
                          const project = await applyChange(
                            session.projectId,
                            request,
                            preview.preview_token,
                          );
                          draft.acceptExternal(project);
                          setPreview(null);
                          setRequest(null);
                        })
                      }
                    >
                      确认应用到当前文稿
                    </button>
                  )}
                </details>
                {deck.template && (
                  <fieldset className="master-settings-group">
                    <legend>当前页内容与章节</legend>
                    <label className="master-field">
                      页标题
                      <input
                        aria-label="当前页标题"
                        value={slide.title ?? ""}
                        maxLength={500}
                        onChange={(e) => updatePage({ title: e.target.value })}
                      />
                    </label>
                    <CustomSelect
                      ariaLabel="当前页型"
                      value={slide.page_type ?? "content"}
                      options={pageTypes}
                      onChange={(v) => updatePage({ page_type: v as PageType })}
                    />
                    <CustomSelect
                      ariaLabel="当前页所属章节"
                      value={slide.chapter_id ?? ""}
                      options={[
                        { value: "", label: "不属于章节" },
                        ...(deck.chapters ?? []).map((c) => ({
                          value: c.id,
                          label: c.title,
                        })),
                      ]}
                      onChange={(chapter_id) =>
                        updatePage({ chapter_id: chapter_id || null })
                      }
                    />
                    <details className="master-document-rules">
                      <summary>
                        管理章节（{deck.chapters?.length ?? 0}）
                      </summary>
                      {(deck.chapters ?? []).map((c) => (
                        <div className="master-field" key={c.id}>
                          <label>
                            章节名称
                            <input
                              aria-label={`重命名章节 ${c.title}`}
                              value={c.title}
                              maxLength={120}
                              onChange={(e) =>
                                updateChapters(
                                  (deck.chapters ?? []).map((item) =>
                                    item.id === c.id
                                      ? {
                                          ...item,
                                          title: e.target.value || "未命名章节",
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                          <button
                            className="btn"
                            onClick={() => {
                              commit((d) => ({
                                ...d,
                                document: {
                                  ...d.document,
                                  chapters: d.document.chapters?.filter(
                                    (item) => item.id !== c.id,
                                  ),
                                  slides: d.document.slides.map((s) =>
                                    s.chapter_id === c.id
                                      ? { ...s, chapter_id: null }
                                      : s,
                                  ),
                                },
                              }));
                              setChapters(
                                chapters.filter((item) => item.id !== c.id),
                              );
                            }}
                          >
                            删除章节关联
                          </button>
                        </div>
                      ))}
                    </details>
                    <button className="btn" onClick={() => setNewChapter(true)}>
                      添加章节
                    </button>
                    <details className="master-document-rules">
                      <summary>本页显示规则</summary>
                      <p>勾选要在本页隐藏的模板元素。</p>
                      {[
                        ...[
                          { id: "chapter", text: "章节标题" },
                          { id: "title", text: "页标题" },
                          { id: "number", text: "页码" },
                          { id: "toc", text: "目录" },
                          { id: "background", text: "背景图" },
                        ],
                        ...(effective?.fixed ?? []).map((item, i) => ({
                          id: item.id,
                          text:
                            item.kind === "image"
                              ? `固定图片 ${i + 1}`
                              : item.text,
                        })),
                        ...(effective?.version === 2
                          ? [
                              ...(effective.global_scene?.elements ?? []),
                              ...(
                                effective.layouts[slide.page_type ?? "content"]
                                  .scene?.elements ?? []
                              ).filter(
                                (e) =>
                                  !effective.layouts[
                                    slide.page_type ?? "content"
                                  ].scene?.semantics?.some(
                                    (s) => s.element_id === e.id,
                                  ),
                              ),
                            ].map((e) => ({ id: e.id, text: e.name || e.kind }))
                          : []),
                      ].map((item) => (
                        <label className="master-check" key={item.id}>
                          <input
                            type="checkbox"
                            checked={
                              slide.template_hidden?.includes(item.id) ?? false
                            }
                            onChange={(e) =>
                              updatePage({
                                template_hidden: e.target.checked
                                  ? [...(slide.template_hidden ?? []), item.id]
                                  : (slide.template_hidden ?? []).filter(
                                      (id) => id !== item.id,
                                    ),
                              })
                            }
                          />
                          {item.text}
                        </label>
                      ))}
                      <button
                        className="btn"
                        onClick={() => updatePage({ template_hidden: [] })}
                      >
                        本页恢复跟随模板
                      </button>
                    </details>
                    {tocOverflow(deck, slide) && (
                      <div role="alert">
                        <p>目录超出本页容量，请添加续页以展示全部章节。</p>
                        <button
                          className="btn"
                          onClick={() => {
                            const offset =
                              (slide.toc_offset ?? 0) +
                              (effective?.layouts.toc.toc_capacity ?? 7);
                            commit((d) => {
                              const slides = [...d.document.slides];
                              slides.splice(
                                slides.findIndex((s) => s.id === slide.id) + 1,
                                0,
                                {
                                  ...newSlide("blank"),
                                  page_type: "toc",
                                  title: "目录（续）",
                                  toc_offset: offset,
                                },
                              );
                              return {
                                ...d,
                                document: { ...d.document, slides },
                              };
                            });
                          }}
                          disabled={deck.slides.length >= 100}
                        >
                          添加目录续页
                        </button>
                      </div>
                    )}
                  </fieldset>
                )}
                <button className="btn" onClick={() => setExample(true)}>
                  将当前文稿另存为示例
                </button>
              </>
            )}
          </fieldset>
        </div>
        <TextInputDialog
          open={newChapter}
          title="添加章节"
          label="章节名称"
          initialValue="新章节"
          maxLength={120}
          onCancel={() => setNewChapter(false)}
          onConfirm={(title) => {
            updateChapters([
              ...(deck.template ? (deck.chapters ?? []) : chapters),
              { id: newId(), title },
            ]);
            setNewChapter(false);
          }}
        />
        <TextInputDialog
          open={example}
          title="另存为示例"
          label="示例名称"
          initialValue={draft.draft.title}
          maxLength={120}
          onCancel={() => setExample(false)}
          onConfirm={(title) => {
            void work(async () => {
              const project = await draft.flush();
              await createExample({ title, document: project.document });
              setExample(false);
              setError("示例已保存，可在模板与示例中复用。");
            });
          }}
        />
      </div>
    </div>
  );
}
