import {
  studioDefinition,
  studioPreview,
  studioAssets,
  previewPage,
  starterDocument,
} from "./studioPreview";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, LayoutTemplate, Copy, Pencil, Trash2 } from "lucide-react";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { SlidePreview } from "../SlideSurface";
import { PresentationPreviewDialog } from "../PresentationPreviewDialog";
import type { Deck } from "../types";
import { presentationKeys } from "../queryKeys";
import {
  listTemplates,
  listExamples,
  fromTemplate,
  fromExample,
  removeTemplate,
  removeExample,
  importBundle,
} from "./api";
import {
  type Definition,
  resolveSlide,
  type Template,
  type Example,
} from "./model";

export function TemplateLibrary({
  onOpen,
  readOnly,
  onEdit,
}: {
  onOpen: (id: string) => void;
  readOnly: boolean;
  onEdit: (id: string) => void;
}) {
  const templates = useQuery({
      queryKey: presentationKeys.templates,
      queryFn: ({ signal }) => listTemplates(signal),
    }),
    examples = useQuery({
      queryKey: presentationKeys.examples,
      queryFn: ({ signal }) => listExamples(signal),
    }),
    cache = useQueryClient();
  const [use, setUse] = useState<{
      kind: "template" | "example";
      item: Template | Example;
    } | null>(null),
    [remove, setRemove] = useState<typeof use>(null),
    [preview, setPreview] = useState<{ title: string; deck: Deck } | null>(
      null,
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [starter, setStarter] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const showPreview = (value: { title: string; deck: Deck }) => {
    opener.current = document.activeElement as HTMLElement;
    setPreview(value);
  };
  const running = useRef(false);
  const refresh = () =>
    cache.invalidateQueries({ queryKey: presentationKeys.all });
  const perform = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="presentation-library master-library workshop-page">
      <WorkshopAppChrome
        title="模板与示例"
        description="用模板统一规范，用完整示例开启下一份演示。"
        actions={
          !readOnly ? (
            <>
              <button className="btn" onClick={() => setStarter(true)}>
                导入技术汇报入门包
              </button>
              <button
                className="workshop-primary"
                onClick={() => onEdit("new")}
              >
                <Plus size={18} />
                新建模板
              </button>
            </>
          ) : null
        }
      />
      <div className="presentation-library-content">
        {error && (
          <div role="alert" className="master-feedback">
            {error}
          </div>
        )}
        <section>
          <div className="master-section-heading">
            <div>
              <h2>
                <LayoutTemplate size={22} />
                文稿模板
              </h2>
              <p>字体、标题、目录、页码与固定元素，一处定义，全稿一致。</p>
            </div>
            <span>{templates.data?.total ?? 0} 个模板</span>
          </div>
          {templates.isPending ? (
            <p role="status">正在加载模板…</p>
          ) : templates.isError ? (
            <button className="btn" onClick={() => void templates.refetch()}>
              加载失败，重试
            </button>
          ) : (
            <div className="master-card-grid">
              {templates.data.items.map((t) => {
                const d = studioPreview(t.definition as Definition);
                return (
                  <article className="master-card" key={t.id}>
                    <button
                      className="master-card-preview"
                      aria-label={`预览模板 ${t.title}`}
                      onClick={() =>
                        showPreview({
                          title: t.title,
                          deck: {
                            ...d,
                            template: null,
                            slides: (
                              [
                                "cover",
                                "toc",
                                "section",
                                "content",
                                "ending",
                              ] as const
                            ).map((type) => {
                              const page = studioPreview(
                                t.definition as Definition,
                                type,
                              );
                              return {
                                ...resolveSlide(page, previewPage(page)),
                                id: `preview-${type}`,
                              };
                            }),
                          },
                        })
                      }
                    >
                      <SlidePreview
                        slide={previewPage(d)}
                        size={d}
                        assetUrls={studioAssets}
                      />
                      <span className="master-badge">5 种页型 · 全局样式</span>
                    </button>
                    <div className="master-card-body">
                      <h3>{t.title}</h3>
                      <p>
                        {t.description || "可复用文稿规范"} · v{t.revision + 1}
                      </p>
                      <div className="master-actions">
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => onEdit(t.id)}
                        >
                          <Pencil size={14} />
                          {readOnly ? "查看配置" : "编辑模板"}
                        </button>
                        {!readOnly && (
                          <>
                            <button
                              className="btn btn-primary"
                              disabled={busy}
                              onClick={() =>
                                setUse({ kind: "template", item: t })
                              }
                            >
                              使用模板
                            </button>
                            <button
                              className="icon-btn"
                              aria-label={`删除模板 ${t.title}`}
                              disabled={busy}
                              onClick={() =>
                                setRemove({ kind: "template", item: t })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
              {!templates.data.items.length && (
                <div className="master-empty">
                  还没有文稿模板。新建模板，或导入无品牌的技术汇报入门包。
                </div>
              )}
            </div>
          )}
        </section>
        <section>
          <div className="master-section-heading">
            <div>
              <h2>
                <Copy size={22} />
                精美示例
              </h2>
              <p>以完整文稿作为起点，保留模板、正文和讲述结构。</p>
            </div>
            <span>{examples.data?.total ?? 0} 份示例</span>
          </div>
          {examples.isPending ? (
            <p role="status">正在加载示例…</p>
          ) : examples.isError ? (
            <button className="btn" onClick={() => void examples.refetch()}>
              加载失败，重试
            </button>
          ) : (
            <div className="master-card-grid">
              {examples.data.items.map((item) => (
                <article className="master-card" key={item.id}>
                  <button
                    className="master-card-preview"
                    aria-label={`预览示例 ${item.title}`}
                    onClick={() =>
                      showPreview({ title: item.title, deck: item.document })
                    }
                  >
                    <SlidePreview
                      slide={item.document.slides[0]}
                      size={item.document}
                    />
                    <span className="master-badge">
                      完整文稿 · {item.document.slides.length} 页
                    </span>
                  </button>
                  <div className="master-card-body">
                    <h3>{item.title}</h3>
                    <p>{item.document.template?.name ?? "独立文稿快照"}</p>
                    <div className="master-actions">
                      <button
                        className="btn"
                        onClick={() =>
                          showPreview({
                            title: item.title,
                            deck: item.document,
                          })
                        }
                      >
                        预览示例
                      </button>
                      {!readOnly && (
                        <>
                          <button
                            className="btn btn-primary"
                            disabled={busy}
                            onClick={() => setUse({ kind: "example", item })}
                          >
                            基于示例新建
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={`删除示例 ${item.title}`}
                            disabled={busy}
                            onClick={() => setRemove({ kind: "example", item })}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              ))}
              {!examples.data.items.length && (
                <div className="master-empty">
                  在文稿编辑器中“另存为示例”，即可在这里复用完整文稿。
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      <TextInputDialog
        open={!!use}
        title="新建演示文稿"
        label="文稿名称"
        initialValue={use?.item.title ?? ""}
        maxLength={120}
        onCancel={() => setUse(null)}
        onConfirm={(title) => {
          if (!use) return;
          void perform(async () => {
            const p = await (
              use.kind === "template" ? fromTemplate : fromExample
            )(use.item.id, use.item.revision, title);
            setUse(null);
            onOpen(p.id);
          });
        }}
      />
      <ConfirmDialog
        open={!!remove}
        title={`删除${remove?.kind === "template" ? "模板" : "示例"}？`}
        description="已有文稿保持不变，绑定快照仍可打开和导出。"
        pending={busy}
        onCancel={() => setRemove(null)}
        onConfirm={() =>
          perform(async () => {
            if (remove)
              await (
                remove.kind === "template" ? removeTemplate : removeExample
              )(remove.item.id, remove.item.revision);
            setRemove(null);
          })
        }
      />
      <ConfirmDialog
        open={starter}
        title="导入技术汇报入门包"
        description="向当前空间加入一份无品牌模板和一份五页示例，不修改已有文稿。"
        tone="primary"
        confirmLabel="导入当前空间"
        pending={busy}
        onCancel={() => setStarter(false)}
        onConfirm={() =>
          perform(async () => {
            const definition = studioDefinition();
            await importBundle({
              template: {
                title: "简洁技术汇报",
                description: "无品牌 · 五种页型与全局样式",
                definition,
              },
              example: {
                title: "技术实践 · 五页示例",
                description: "从背景到交付的完整技术汇报示例",
                document: starterDocument(definition),
              },
            });
            setStarter(false);
          })
        }
      />
      {preview && (
        <PresentationPreviewDialog
          assetUrls={studioAssets}
          title={preview.title}
          slides={preview.deck.slides.map((s, i) =>
            resolveSlide(preview.deck, s, i),
          )}
          size={preview.deck}
          loading={false}
          failed={false}
          retry={() => {}}
          actionLabel="关闭预览"
          onUse={() => setPreview(null)}
          returnFocus={() => opener.current?.focus()}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
