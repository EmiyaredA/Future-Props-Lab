import { useState } from "react";
import { Activity, Copy, FileCheck2, Plus, Search, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { methodNames, type Template, type StandardDocument } from "./api";
import { AcceptanceChoice } from "./AcceptanceChoice";
const mediaNames = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
};
type MediaFilter = "all" | keyof typeof mediaNames;
const media = (template: Template) => [
  ...new Set(
    template.document.criteria?.flatMap((item) => item.kinds ?? []) ?? [],
  ),
];
function appearance(template: Template) {
  const id = template.id.replace("builtin:", "");
  if (id === "motion-transfer")
    return {
      Icon: Activity,
      tone: "coral",
      description: "让目标角色复现原视频动作，核对外观、姿态与动作节奏",
    };
  return {
    Icon: FileCheck2,
    tone: "neutral",
    description: "从自己的要求开始，自由定义标准",
  };
}
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
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [selected, setSelected] = useState<string>();
  const [pane, setPane] = useState("list");
  const [deleting, setDeleting] = useState<Template>();
  const term = search.trim().toLocaleLowerCase();
  const filtered = templates.filter(
    (t) =>
      (filter === "all" || media(t).includes(filter)) &&
      [
        t.title,
        ...(t.document.criteria ?? []).flatMap((item) => [
          item.title,
          item.requirement,
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(term),
  );
  const current = filtered.find((t) => t.id === selected) ?? filtered[0];
  const builtin = filtered.filter((t) => t.builtin),
    custom = filtered.filter((t) => !t.builtin);
  const prepare = [
    ...new Set(
      current?.document.criteria
        ?.map((item) => item.reference_label?.trim())
        .filter((label): label is string => !!label) ?? [],
    ),
  ];
  const pick = (template: Template) => {
    setSelected(template.id);
    setPane("preview");
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    setSelected(undefined);
  };
  return (
    <div className="acceptance-template-layout">
      <div className="acceptance-compact-tabs" aria-label="模板面板">
        <button aria-pressed={pane === "list"} onClick={() => setPane("list")}>
          模板列表
        </button>
        <button
          aria-pressed={pane === "preview"}
          onClick={() => setPane("preview")}
        >
          模板预览
        </button>
      </div>
      <section
        className={`acceptance-surface acceptance-library ${pane === "list" ? "is-compact-active" : ""}`}
      >
        <h2>选择参考模板</h2>
        <p className="acceptance-muted">
          从动作迁移模板开始，准备角色基准图和原动作视频，再配置项目要求。
        </p>
        <div className="acceptance-library-toolbar">
          <label className="acceptance-search">
            <Search size={16} />
            <input
              aria-label="搜索验收模板"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
              placeholder="搜索模板或验收要求…"
            />
          </label>
          <AcceptanceChoice
            label="适用媒体筛选"
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setSelected(undefined);
            }}
            options={[
              { value: "all", label: "全部" },
              ...Object.entries(mediaNames).map(([value, label]) => ({
                value: value as MediaFilter,
                label,
              })),
            ]}
          />
        </div>
        <div className="acceptance-template-grid">
          {builtin.map((t) => {
            const { Icon, tone, description } = appearance(t);
            return (
              <button
                key={t.id}
                className={`acceptance-template ${current?.id === t.id ? "is-selected" : ""}`}
                aria-pressed={current?.id === t.id}
                onClick={() => pick(t)}
              >
                <span
                  className={`acceptance-template-icon ${tone}`}
                  aria-hidden="true"
                >
                  <Icon size={22} />
                </span>
                <span>
                  <strong>{t.title}</strong>
                  <p>{description}</p>
                  <small>
                    {media(t)
                      .map((kind) => mediaNames[kind])
                      .join("、") || "自定义"}{" "}
                    · {t.document.criteria?.length ?? 0} 项要求
                  </small>
                </span>
              </button>
            );
          })}
        </div>
        {!builtin.length && (
          <p className="acceptance-empty">没有匹配的内置模板。</p>
        )}
        <div className="acceptance-list-heading">
          <h3>我的模板</h3>
          <button
            disabled={!writable}
            onClick={() =>
              onUse({ title: "自定义标准", node_ids: [], criteria: [] })
            }
          >
            <Plus size={16} />
            从空白开始
          </button>
        </div>
        {custom.length ? (
          <div className="acceptance-table-scroll">
            <table className="acceptance-template-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>适用媒体</th>
                  <th>条目</th>
                  <th>
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {custom.map((t) => (
                  <tr
                    key={t.id}
                    className={current?.id === t.id ? "is-selected" : ""}
                  >
                    <td>
                      <button
                        className="acceptance-text-button"
                        onClick={() => pick(t)}
                      >
                        {t.title}
                      </button>
                    </td>
                    <td>
                      {media(t)
                        .map((kind) => mediaNames[kind])
                        .join("、") || "自定义"}
                    </td>
                    <td>{t.document.criteria?.length ?? 0}</td>
                    <td>
                      <button
                        disabled={!writable}
                        aria-label={`删除模板 ${t.title}`}
                        onClick={() => setDeleting(t)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="acceptance-empty">
            {term || filter !== "all"
              ? "没有匹配的账号模板。"
              : "保存常用标准后，可在当前账号的其他项目复用。"}
          </p>
        )}
      </section>
      <aside
        className={`acceptance-surface acceptance-template-detail ${pane === "preview" ? "is-compact-active" : ""}`}
      >
        {current ? (
          <>
            <small>{current.builtin ? "内置模板" : "账号模板"}</small>
            <h2>{current.title}</h2>
            <p className="acceptance-muted">
              可复制后自由修改，项目参考资料在使用后绑定。
            </p>
            <div className="acceptance-rule-list">
              {current.document.criteria?.map((item, index) => (
                <div key={item.id} className="acceptance-rule-summary">
                  <span className="acceptance-rule-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className="acceptance-inline">
                      <strong>{item.title}</strong>
                      <span className="acceptance-badge neutral">
                        {methodNames[item.method ?? "manual"]}
                      </span>
                      <span
                        className={`acceptance-badge ${item.required ? "required" : "optional"}`}
                      >
                        {item.required ? "必须满足" : "建议满足"}
                      </span>
                    </div>
                    <p>{item.requirement}</p>
                  </div>
                </div>
              ))}
            </div>
            {!current.document.criteria?.length && <p>添加自己的验收要求。</p>}
            {!!prepare.length && (
              <section className="acceptance-preparation">
                <h3>使用前准备</h3>
                {prepare.map((label) => (
                  <div key={label}>
                    <FileCheck2 size={17} />
                    <span>{label}</span>
                  </div>
                ))}
              </section>
            )}
            <small>
              AI
              仅辅助检查抽样画面；连续动作、节奏与音画同步需人工完整播放核对。
            </small>
            <button
              className="acceptance-primary"
              disabled={!writable}
              onClick={() => onUse(structuredClone(current.document))}
            >
              <Copy size={16} />
              使用模板并配置
            </button>
            <small>复制后可自由调整，不影响原模板。</small>
          </>
        ) : (
          <p className="acceptance-empty">
            没有匹配的模板。调整搜索或媒体筛选后再试。
          </p>
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
