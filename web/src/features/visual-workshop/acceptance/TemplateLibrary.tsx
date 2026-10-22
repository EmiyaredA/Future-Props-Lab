import { useState } from "react";
import { Copy, FileCheck2, Plus, Search, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { methodNames, type Template, type StandardDocument } from "./api";
export function TemplateLibrary({
  templates,
  onUse,
  onDelete,
  writable,
}: {
  templates: Template[];
  onUse: (document: StandardDocument) => void;
  onDelete: (template: Template) => void;
  writable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>();
  const [deleting, setDeleting] = useState<Template>();
  const filtered = templates.filter((t) => t.title.includes(search));
  const current = filtered.find((t) => t.id === selected) ?? filtered[0];
  return (
    <div className="acceptance-template-layout">
      <section className="acceptance-surface">
        <h2>选择参考模板</h2>
        <p className="acceptance-muted">复制一套清单，再按你的项目调整要求。</p>
        <label className="acceptance-search">
          <Search size={17} />
          <input
            aria-label="搜索验收模板"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模板或验收要求…"
          />
        </label>
        <div className="acceptance-template-grid">
          {filtered.map((t) => (
            <button
              key={t.id}
              className={`acceptance-template ${current?.id === t.id ? "is-selected" : ""}`}
              onClick={() => setSelected(t.id)}
            >
              <FileCheck2 size={24} />
              <span>
                <strong>{t.title}</strong>
                <small>
                  {t.builtin ? "内置参考" : "Workspace 模板"} ·{" "}
                  {t.document.criteria?.length ?? 0} 项要求
                </small>
              </span>
            </button>
          ))}
        </div>
        {!filtered.length && <p>没有匹配的模板。</p>}
        <button
          disabled={!writable}
          onClick={() =>
            onUse({ title: "自定义标准", node_ids: [], criteria: [] })
          }
        >
          <Plus size={16} /> 从空白开始
        </button>
      </section>
      <aside className="acceptance-surface acceptance-template-detail">
        {current && (
          <>
            <h2>{current.title}</h2>
            <p className="acceptance-muted">
              {current.builtin ? "内置参考模板" : "当前 Workspace 内复用"} ·
              可复制后自由修改
            </p>
            <div className="acceptance-rule-list">
              {current.document.criteria?.map((item) => (
                <div key={item.id} className="acceptance-rule-summary">
                  <strong>{item.title}</strong>
                  <small>
                    {methodNames[item.method ?? "manual"]} ·{" "}
                    {item.required ? "必须满足" : "建议满足"}
                  </small>
                  <p>{item.requirement}</p>
                </div>
              ))}
            </div>
            {!current.document.criteria?.length && <p>添加自己的验收要求。</p>}
            <p className="acceptance-muted">
              应用模板后再绑定项目素材。音频、台词和跨镜头检查首版由人工完成。
            </p>
            <div className="acceptance-actions">
              <button
                className="acceptance-primary"
                disabled={!writable}
                onClick={() => onUse(structuredClone(current.document))}
              >
                <Copy size={16} /> 使用模板并配置
              </button>
              {!current.builtin && (
                <button
                  disabled={!writable}
                  aria-label="删除模板"
                  onClick={() => setDeleting(current)}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <small>模板更新不会覆盖已经发布的项目标准。</small>
          </>
        )}
      </aside>
      {deleting && (
        <ConfirmDialog
          open
          title="删除验收模板"
          description="已应用到项目的标准不受影响。"
          confirmLabel="删除"
          onConfirm={() => {
            onDelete(deleting);
            setDeleting(undefined);
          }}
          onCancel={() => setDeleting(undefined)}
        />
      )}
    </div>
  );
}
