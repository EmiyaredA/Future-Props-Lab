import { ClipboardList, Info, LockKeyhole } from "lucide-react";
import { SchemeIcon } from "./AcceptanceSchemePicker";
import { CheckScope } from "./CheckScope";
import type { AcceptanceCatalog } from "./nodeApi";

export function ReadonlyTemplates({ catalog }: { catalog: AcceptanceCatalog }) {
  const template = catalog.items[0];
  if (!template) return <p>暂无内置验收模板。</p>;
  return (
    <div className="acceptance-readonly-layout">
      <aside className="acceptance-template-sidebar acceptance-surface">
        <h2>
          内置模板 <small>1</small>
        </h2>
        <div className="acceptance-fixed-template">
          <span className="acceptance-template-icon">
            <ClipboardList size={26} />
          </span>
          <div>
            <strong>
              {template.title}{" "}
              <span className="acceptance-badge builtin">内置</span>
            </strong>
            <small>目标角色复现参考动作</small>
          </div>
        </div>
      </aside>
      <section className="acceptance-surface acceptance-template-info">
        <div className="acceptance-inline">
          <h2>{template.title}</h2>
          <span className="acceptance-badge neutral">
            <LockKeyhole size={13} />
            只读
          </span>
        </div>
        <p className="acceptance-muted">固定验收方案，在视频节点中选择使用。</p>
        <section className="acceptance-plan-group">
          <h3>可用方案</h3>
          {template.schemes.map((scheme) => (
            <article key={scheme.id} className="acceptance-fixed-scheme">
              <span className={`acceptance-model-icon scheme-${scheme.kind}`}>
                <SchemeIcon scheme={scheme} />
              </span>
              <div className="acceptance-scheme-description">
                <h3>
                  {scheme.title}
                  <span className="acceptance-badge builtin">固定接入</span>
                </h3>
                <p className="acceptance-muted">
                  {scheme.kind === "model_api"
                    ? "抽样画面的逐项检查。"
                    : "使用节点上下文与媒体资料进行定制检查。"}
                </p>
                <dl>
                  <dt>输入内容</dt>
                  <dd>{scheme.input_description}</dd>
                  <dt>返回内容</dt>
                  <dd>{scheme.output_description}</dd>
                </dl>
              </div>
              <div className="acceptance-connection">
                <span className="acceptance-connection-caption">接入</span>
                <div className="acceptance-connection-brand">
                  <span
                    className={`acceptance-model-icon scheme-${scheme.kind}`}
                  >
                    <SchemeIcon scheme={scheme} />
                  </span>
                  <div>
                    <strong>{scheme.connection_label}</strong>
                    {scheme.model_slug && <code>{scheme.model_slug}</code>}
                    <small className={scheme.available ? "is-available" : ""}>
                      {scheme.message}
                    </small>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
        <section className="acceptance-scope-card">
          <h3>检查范围</h3>
          <CheckScope criteria={template.criteria} />
          <p className="acceptance-muted">
            <Info size={17} />
            连续动作与无法判断项保留人工确认。
          </p>
          <details className="acceptance-readonly-requirements">
            <summary>查看固定检查要求</summary>
            {template.criteria.map((item) => (
              <div key={item.id}>
                <strong>{item.title}</strong>
                <p>{item.requirement}</p>
              </div>
            ))}
          </details>
        </section>
        <p className="acceptance-template-footnote">
          验收所需素材、提示词与预期规格从节点自动读取，无需重复填写。
        </p>
        <p className="acceptance-muted">
          验收只记录质量结果，不限制最终输出选择。
        </p>
      </section>
    </div>
  );
}
