import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { VisualCanvasNode } from "../api";
import {
  methodNames,
  newCriterion,
  type Criterion,
  type StandardDocument,
} from "./api";
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
  const items = document.criteria ?? [];
  const active = items.find((item) => item.id === selected) ?? items[0];
  const update = (values: Partial<Criterion>) =>
    active &&
    onChange({
      ...document,
      criteria: items.map((item) =>
        item.id === active.id ? { ...item, ...values } : item,
      ),
    });
  const move = (offset: number) => {
    if (!active) return;
    const i = items.findIndex((item) => item.id === active.id);
    if (i + offset < 0 || i + offset >= items.length) return;
    const next = [...items];
    [next[i], next[i + offset]] = [next[i + offset], next[i]];
    onChange({ ...document, criteria: next });
  };
  const allKinds = ["image", "video", "audio", "text"] as const;
  const labels = { image: "图片", video: "视频", audio: "音频", text: "文本" };
  return (
    <div className="acceptance-editor-layout">
      <section className="acceptance-surface">
        <label>
          标准名称
          <input
            disabled={!writable}
            value={document.title}
            onChange={(e) => onChange({ ...document, title: e.target.value })}
            maxLength={120}
          />
        </label>
        <fieldset disabled={!writable}>
          <legend>应用节点</legend>
          <p className="acceptance-muted">
            不勾选时应用到全部节点，条目按媒体类型生效。
          </p>
          <div className="acceptance-scope">
            {nodes.map((node) => (
              <label key={node.id}>
                <input
                  type="checkbox"
                  checked={(document.node_ids ?? []).includes(node.id)}
                  onChange={(e) =>
                    onChange({
                      ...document,
                      node_ids: e.target.checked
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
        <div className="acceptance-rule-list">
          {items.map((item, index) => (
            <button
              className={`acceptance-rule ${active?.id === item.id ? "is-selected" : ""}`}
              key={item.id}
              onClick={() => setSelected(item.id)}
            >
              <span className="acceptance-rule-number">{index + 1}</span>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {methodNames[item.method ?? "manual"]} ·{" "}
                  {item.required ? "必须满足" : "建议满足"}
                </small>
              </span>
            </button>
          ))}
        </div>
        <button
          disabled={!writable || items.length >= 40}
          onClick={() => {
            const item = newCriterion();
            onChange({ ...document, criteria: [...items, item] });
            setSelected(item.id);
          }}
        >
          <Plus size={16} /> 添加验收项
        </button>
        <div className="acceptance-policy">
          <label>
            <input
              disabled={!writable}
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />{" "}
            强制验收后才能采用输出
          </label>
          <p>
            必须项全部通过，所有待确认项处理后，由你确认结论。新输出先保存为候选。
          </p>
        </div>
      </section>
      <section className="acceptance-surface">
        <h2>编辑验收项</h2>
        {active ? (
          <fieldset disabled={!writable} className="acceptance-fields">
            <label>
              验收项名称
              <input
                value={active.title}
                maxLength={120}
                onChange={(e) => update({ title: e.target.value })}
              />
            </label>
            <label>
              具体要求
              <textarea
                value={active.requirement}
                rows={4}
                maxLength={3000}
                onChange={(e) => update({ requirement: e.target.value })}
              />
            </label>
            <div>
              <span>适用媒体</span>
              <div className="acceptance-actions">
                {allKinds.map((kind) => (
                  <label key={kind}>
                    <input
                      type="checkbox"
                      checked={active.kinds?.includes(kind)}
                      onChange={(e) => {
                        const kinds = e.target.checked
                          ? [...(active.kinds ?? []), kind]
                          : active.kinds?.filter((value) => value !== kind);
                        update({
                          kinds,
                          method: kinds?.some(
                            (k) => k === "text" || k === "audio",
                          )
                            ? "manual"
                            : active.method,
                        });
                      }}
                    />
                    {labels[kind]}
                  </label>
                ))}
              </div>
            </div>
            <label>
              检查方式
              <CustomSelect
                value={active.method ?? "manual"}
                ariaLabel="检查方式"
                onChange={(value) =>
                  update({ method: value as Criterion["method"] })
                }
                options={Object.entries(methodNames).map(([value, label]) => ({
                  value,
                  label,
                  disabled:
                    value !== "manual" &&
                    active.kinds?.some((k) => k === "audio" || k === "text"),
                }))}
              />
            </label>
            {active.method === "automatic" ? (
              <div className="acceptance-specifications">
                {(
                  [
                    ["min_width", "最小宽度"],
                    ["min_height", "最小高度"],
                    ["min_duration", "最短秒数"],
                    ["max_duration", "最长秒数"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min={0}
                      aria-label={label}
                      value={active.specifications?.[key] ?? ""}
                      onChange={(e) =>
                        update({
                          specifications: {
                            require_audio: false,
                            ...active.specifications,
                            [key]:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  画幅
                  <CustomSelect
                    value={active.specifications?.ratio ?? ""}
                    ariaLabel="验收画幅"
                    options={[
                      { value: "", label: "不限" },
                      ...["16:9", "9:16", "1:1", "4:3", "3:4"].map((value) => ({
                        value,
                        label: value,
                      })),
                    ]}
                    onChange={(value) =>
                      update({
                        specifications: {
                          require_audio: false,
                          ...active.specifications,
                          ratio: (value || null) as NonNullable<
                            Criterion["specifications"]
                          >["ratio"],
                        },
                      })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={active.specifications?.require_audio ?? false}
                    onChange={(e) =>
                      update({
                        specifications: {
                          ...active.specifications,
                          require_audio: e.target.checked,
                        },
                      })
                    }
                  />{" "}
                  视频必须包含音轨
                </label>
              </div>
            ) : (
              <>
                <label>
                  参考位置说明
                  <input
                    value={active.reference_label}
                    placeholder="例如：角色基准图（可选）"
                    onChange={(e) =>
                      update({ reference_label: e.target.value })
                    }
                  />
                </label>
                <fieldset>
                  <legend>绑定项目参考素材</legend>
                  <div className="acceptance-scope">
                    {nodes
                      .filter(
                        (node) =>
                          (node.kind === "image" || node.kind === "video") &&
                          node.asset_id,
                      )
                      .map((node) => (
                        <label key={node.id}>
                          <input
                            type="checkbox"
                            checked={active.reference_asset_ids?.includes(
                              node.kind !== "text" ? node.asset_id! : "",
                            )}
                            onChange={(e) => {
                              if (node.kind === "text" || !node.asset_id)
                                return;
                              update({
                                reference_asset_ids: e.target.checked
                                  ? [
                                      ...(active.reference_asset_ids ?? []),
                                      node.asset_id,
                                    ]
                                  : active.reference_asset_ids?.filter(
                                      (id) => id !== node.asset_id,
                                    ),
                              });
                            }}
                          />
                          {node.title} · v{node.final_version ?? 1}
                        </label>
                      ))}
                  </div>
                  <small>固定绑定当前素材版本，发布后保留参考快照。</small>
                </fieldset>
              </>
            )}
            <label>
              <input
                type="checkbox"
                checked={active.required ?? true}
                onChange={(e) => update({ required: e.target.checked })}
              />{" "}
              必须满足
            </label>
            <div className="acceptance-actions">
              <button onClick={() => move(-1)} aria-label="上移验收项">
                <ArrowUp size={16} />
              </button>
              <button onClick={() => move(1)} aria-label="下移验收项">
                <ArrowDown size={16} />
              </button>
              <button
                onClick={() =>
                  onChange({
                    ...document,
                    criteria: items.filter((item) => item.id !== active.id),
                  })
                }
              >
                <Trash2 size={16} /> 删除此项
              </button>
            </div>
            <p className="acceptance-notice">
              AI 无法判断时标记待确认；音频与文本仅支持人工检查。
            </p>
          </fieldset>
        ) : (
          <p>从模板复制或添加一条验收要求。</p>
        )}
      </section>
    </div>
  );
}
