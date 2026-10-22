import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import type { VisualCanvasNode } from "../api";
import {
  methodNames,
  newCriterion,
  type Criterion,
  type StandardDocument,
} from "./api";
import { AcceptanceChoice } from "./AcceptanceChoice";
import { ReferenceMaterials } from "./ReferenceMaterials";
import { SpecificationFields } from "./SpecificationFields";
const mediaNames = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
};
export function StandardEditor({
  document,
  onChange,
  nodes,
  required,
  setRequired,
  writable,
}: {
  document: StandardDocument;
  onChange: (doc: StandardDocument) => void;
  nodes: VisualCanvasNode[];
  required: boolean;
  setRequired: (value: boolean) => void;
  writable: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const [compactPane, setCompactPane] = useState("list");
  const items = document.criteria ?? [],
    active = items.find((item) => item.id === selected) ?? items[0];
  const update = (values: Partial<Criterion>) =>
    active &&
    onChange({
      ...document,
      criteria: items.map((item) =>
        item.id === active.id ? { ...item, ...values } : item,
      ),
    });
  const move = (offset: number) => {
    const index = items.findIndex((item) => item.id === active?.id);
    if (index < 0 || index + offset < 0 || index + offset >= items.length)
      return;
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange({ ...document, criteria: next });
  };
  const manualOnly = active?.kinds?.some(
    (kind) => kind === "audio" || kind === "text",
  );
  return (
    <div className="acceptance-editor-layout">
      <div className="acceptance-compact-tabs" aria-label="标准编辑面板">
        <button
          aria-pressed={compactPane === "list"}
          onClick={() => setCompactPane("list")}
        >
          验收清单
        </button>
        <button
          aria-pressed={compactPane === "detail"}
          onClick={() => setCompactPane("detail")}
        >
          条目详情
        </button>
      </div>
      <section
        className={`acceptance-surface acceptance-standard-sidebar ${compactPane === "list" ? "is-compact-active" : ""}`}
      >
        <h2>{document.title}</h2>
        <label className="acceptance-inline-field">
          标准名称
          <input
            disabled={!writable}
            value={document.title}
            maxLength={120}
            onChange={(event) =>
              onChange({ ...document, title: event.target.value })
            }
          />
        </label>
        <details className="acceptance-scope-settings">
          <summary>
            应用范围{" "}
            <span>
              {document.node_ids?.length
                ? `${document.node_ids.length} 个节点`
                : "全部节点"}
            </span>
          </summary>
          <fieldset disabled={!writable}>
            <legend className="sr-only">应用节点</legend>
            <small>不勾选时应用到全部节点，条目按媒体类型生效。</small>
            <div className="acceptance-scope">
              {nodes.map((node) => (
                <label key={node.id}>
                  <input
                    type="checkbox"
                    checked={(document.node_ids ?? []).includes(node.id)}
                    onChange={(event) =>
                      onChange({
                        ...document,
                        node_ids: event.target.checked
                          ? [...(document.node_ids ?? []), node.id]
                          : document.node_ids?.filter((id) => id !== node.id),
                      })
                    }
                  />
                  {node.title}
                </label>
              ))}
            </div>
          </fieldset>
        </details>
        <div className="acceptance-list-heading">
          <h3>验收清单</h3>
          <small>
            {items.length} 项 · {items.filter((item) => item.required).length}{" "}
            项必须满足
          </small>
        </div>
        <div className="acceptance-rule-list acceptance-standard-list">
          {items.map((item, index) => (
            <button
              key={item.id}
              className={`acceptance-rule ${active?.id === item.id ? "is-selected" : ""}`}
              aria-pressed={active?.id === item.id}
              onClick={() => {
                setSelected(item.id);
                setCompactPane("detail");
              }}
            >
              <span className="acceptance-rule-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="acceptance-rule-icon" aria-hidden="true">
                {item.method === "automatic" ? (
                  <Settings2 size={18} />
                ) : item.method === "ai" ? (
                  <Sparkles size={18} />
                ) : (
                  <UserRound size={18} />
                )}
              </span>
              <span className="acceptance-rule-copy">
                <strong>{item.title}</strong>
                <small>
                  {item.reference_label || item.requirement || "填写具体要求"}
                </small>
              </span>
              <span className="acceptance-badge neutral">
                {methodNames[item.method ?? "manual"]}
              </span>
              <span
                className={`acceptance-badge ${item.required ? "required" : "optional"}`}
              >
                {item.required ? "必须满足" : "建议满足"}
              </span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
        <button
          className="acceptance-add-rule"
          disabled={!writable || items.length >= 40}
          onClick={() => {
            const item = newCriterion();
            onChange({ ...document, criteria: [...items, item] });
            setSelected(item.id);
            setCompactPane("detail");
          }}
        >
          <Plus size={16} />
          添加验收项
        </button>
        <div className="acceptance-policy">
          <div className="acceptance-inline">
            <ShieldCheck size={17} />
            <h3>输出采用规则</h3>
          </div>
          <label>
            <input
              disabled={!writable}
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
            />
            强制验收后才能采用输出
          </label>
          <p>
            必须项全部通过，待确认项处理后，由你确认结论。新输出先保存为候选。
          </p>
        </div>
        <small>模板更新不会覆盖已经发布的项目标准。</small>
      </section>
      <section
        className={`acceptance-surface acceptance-rule-editor ${compactPane === "detail" ? "is-compact-active" : ""}`}
      >
        <div className="acceptance-editor-heading">
          <div className="acceptance-inline">
            <span className="acceptance-rule-number">
              {active
                ? String(items.indexOf(active) + 1).padStart(2, "0")
                : "—"}
            </span>
            <h2>{active?.title || "编辑验收项"}</h2>
            {active && (
              <span
                className={`acceptance-badge ${active.required ? "required" : "optional"}`}
              >
                {active.required ? "必须满足" : "建议满足"}
              </span>
            )}
          </div>
          <div className="acceptance-actions">
            <button
              disabled={!writable || items.indexOf(active) <= 0}
              onClick={() => move(-1)}
              aria-label="上移验收项"
            >
              <ArrowUp size={16} />
            </button>
            <button
              disabled={
                !writable ||
                !active ||
                items.indexOf(active) >= items.length - 1
              }
              onClick={() => move(1)}
              aria-label="下移验收项"
            >
              <ArrowDown size={16} />
            </button>
            <button
              disabled={!writable || !active}
              aria-label="删除此项"
              onClick={() =>
                onChange({
                  ...document,
                  criteria: items.filter((item) => item.id !== active.id),
                })
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        {active ? (
          <fieldset disabled={!writable} className="acceptance-fields">
            <div className="acceptance-name-media">
              <label>
                验收项名称
                <input
                  value={active.title}
                  maxLength={120}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </label>
              <fieldset className="acceptance-media-options">
                <legend>适用媒体</legend>
                <div className="acceptance-actions">
                  {(Object.keys(mediaNames) as (keyof typeof mediaNames)[]).map(
                    (kind) => (
                      <label
                        key={kind}
                        className={
                          active.kinds?.includes(kind) ? "is-checked" : ""
                        }
                      >
                        <input
                          type="checkbox"
                          checked={active.kinds?.includes(kind)}
                          onChange={(event) => {
                            const kinds = event.target.checked
                              ? [...(active.kinds ?? []), kind]
                              : active.kinds?.filter((value) => value !== kind);
                            update({
                              kinds,
                              method: kinds?.some(
                                (kind) => kind === "audio" || kind === "text",
                              )
                                ? "manual"
                                : active.method,
                            });
                          }}
                        />
                        {mediaNames[kind]}
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
            </div>
            <label>
              具体要求
              <textarea
                value={active.requirement}
                rows={3}
                maxLength={3000}
                onChange={(event) =>
                  update({ requirement: event.target.value })
                }
              />
            </label>
            <div>
              <span className="acceptance-field-label">检查方式</span>
              <AcceptanceChoice
                label="检查方式"
                value={active.method ?? "manual"}
                disabled={!writable}
                onChange={(method) => update({ method })}
                options={Object.entries(methodNames).map(([value, label]) => ({
                  value: value as NonNullable<Criterion["method"]>,
                  label,
                  disabled: value !== "manual" && manualOnly,
                }))}
              />
              <small>
                AI 返回建议，最终结论由你确认；音频与文本仅支持人工检查。
              </small>
            </div>
            {active.method === "automatic" ? (
              <SpecificationFields
                value={active.specifications}
                onChange={(specifications) => update({ specifications })}
              />
            ) : (
              <>
                <ReferenceMaterials
                  ids={active.reference_asset_ids ?? []}
                  nodes={nodes}
                  disabled={!writable}
                  onChange={(reference_asset_ids) =>
                    update({ reference_asset_ids })
                  }
                />
                <label className="acceptance-inline-field">
                  参考位置说明
                  <input
                    value={active.reference_label}
                    maxLength={120}
                    placeholder="例如：角色基准图（可选）"
                    onChange={(event) =>
                      update({ reference_label: event.target.value })
                    }
                  />
                </label>
              </>
            )}
            <div className="acceptance-level-field">
              <span>要求级别</span>
              <AcceptanceChoice
                label="要求级别"
                value={active.required ? "required" : "optional"}
                disabled={!writable}
                onChange={(value) => update({ required: value === "required" })}
                options={[
                  { value: "required", label: "必须满足" },
                  { value: "optional", label: "建议满足" },
                ]}
              />
            </div>
            <p className="acceptance-notice">
              缺少必要参考时先补充；无法判断时标记待确认。
            </p>
          </fieldset>
        ) : (
          <p className="acceptance-empty">从模板复制或添加一条验收要求。</p>
        )}
      </section>
    </div>
  );
}
