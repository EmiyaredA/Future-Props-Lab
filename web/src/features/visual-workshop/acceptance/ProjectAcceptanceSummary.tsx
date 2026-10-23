import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  Film,
  FolderOpen,
  Image,
  Info,
  LayoutGrid,
  MinusCircle,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { visualAssetDownloadPath } from "../api";
import {
  acceptanceStateNames,
  type AcceptanceCatalog,
  type AcceptanceSummary,
} from "./nodeApi";
import { AcceptanceThumbnail } from "./ReferenceMaterialRow";
import { SchemeIcon } from "./AcceptanceSchemePicker";
import "./summary.css";

function SummaryMedia({ asset, label }: { asset?: string; label: string }) {
  const blob = useApiBlobUrl(asset ? visualAssetDownloadPath(asset) : null);
  return (
    <figure className="acceptance-summary-media">
      <div>
        {blob.url ? (
          <video
            src={blob.url}
            muted
            playsInline
            preload="metadata"
            aria-label={label}
          />
        ) : (
          <Film size={30} />
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
const time = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${((ms % 60000) / 1000).toFixed(1).padStart(4, "0")}`;
export function ProjectAcceptanceSummary({
  summary,
  catalog,
  onOpenNode,
}: {
  summary: AcceptanceSummary;
  catalog?: AcceptanceCatalog;
  onOpenNode?: (node: string, output?: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [selected, setSelected] = useState<string>();
  const items = summary.items.filter(
    (item) =>
      item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (!pendingOnly || !["passed", "no_output"].includes(item.state)),
  );
  const current = items.find((item) => item.node_id === selected) ?? items[0];
  const schemes = catalog?.items.flatMap((item) => item.schemes) ?? [];
  const scheme = schemes.find((item) => item.id === current?.scheme_id);
  const run = current?.run;
  const rawInputs = run?.snapshot.inputs?.assets;
  const motion = (
    Array.isArray(rawInputs)
      ? (rawInputs as { role: string; asset_id: string }[])
      : []
  ).find((item) => item.role === "motion");
  const issue = run?.results.find((item) => item.verdict === "failed");
  const report = run?.execution_result?.report as
    { summary?: string } | undefined;
  const duration = Number(run?.snapshot.metadata?.duration_ms ?? 0);
  const start = issue?.start_ms,
    end = issue?.end_ms;
  const open = () => {
    if (current) onOpenNode?.(current.node_id, current.output_id ?? undefined);
  };
  const counts = [
    { icon: CheckCircle2, state: "passed", label: "已通过" },
    { icon: CircleAlert, state: "failed", label: "需修改" },
    { icon: Clock3, state: "pending", label: "待确认" },
    { icon: MinusCircle, state: "uninspected", label: "未验收" },
  ];
  const badge = (item: AcceptanceSummary["items"][number]) => (
    <span className={`acceptance-badge ${item.state}`}>
      {item.state === "passed" ? (
        <CheckCircle2 size={16} />
      ) : item.state === "failed" ? (
        <CircleAlert size={16} />
      ) : item.state === "pending" ? (
        <Clock3 size={16} />
      ) : (
        <MinusCircle size={16} />
      )}
      {item.run?.status === "failed"
        ? "检查失败"
        : (acceptanceStateNames[item.state] ?? item.state)}
    </span>
  );
  return (
    <div className="acceptance-summary-layout">
      <section className="acceptance-surface acceptance-summary-table">
        <h2>节点验收汇总</h2>
        <p className="acceptance-muted">
          查看各节点当前输出的验收状态，进入节点处理问题。
        </p>
        <div className="acceptance-summary-toolbar">
          <span>
            <LayoutGrid size={20} />
            {summary.items.length} 个生成节点
          </span>
          {counts.map(({ icon: Icon, state, label }) => (
            <span className={`summary-count ${state}`} key={state}>
              <Icon size={20} />
              {
                summary.items.filter(
                  (i) =>
                    i.state === state ||
                    (state === "uninspected" && i.state === "unconfigured"),
                ).length
              }{" "}
              {label}
            </span>
          ))}
          <label className="acceptance-search">
            <Search size={16} />
            <input
              aria-label="搜索验收节点"
              placeholder="搜索节点"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="acceptance-summary-filter">
            <button
              className={!pendingOnly ? "is-selected" : ""}
              aria-pressed={!pendingOnly}
              onClick={() => setPendingOnly(false)}
            >
              全部
            </button>
            <button
              className={pendingOnly ? "is-selected" : ""}
              aria-pressed={pendingOnly}
              onClick={() => setPendingOnly(true)}
            >
              需处理
            </button>
          </div>
        </div>
        <div className="acceptance-table-scroll">
          <table className="acceptance-template-table">
            <thead>
              <tr>
                <th>节点</th>
                <th>当前版本</th>
                <th>验收方案</th>
                <th>当前状态</th>
                <th>最终输出</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.node_id}
                  className={
                    current?.node_id === item.node_id ? "is-selected" : ""
                  }
                >
                  <td>
                    <button
                      className="acceptance-summary-node"
                      onClick={() => setSelected(item.node_id)}
                    >
                      {item.output_asset_id ? (
                        <AcceptanceThumbnail
                          assetId={item.output_asset_id}
                          kind={item.kind}
                          alt=""
                        />
                      ) : (
                        <span className="acceptance-thumbnail">
                          <Film size={22} />
                        </span>
                      )}
                      <strong>{item.title}</strong>
                    </button>
                  </td>
                  <td>
                    {item.output_version ? `v${item.output_version}` : "—"}
                  </td>
                  <td>
                    {schemes.find((s) => s.id === item.scheme_id)?.title ??
                      (item.scheme_id ? "历史方案" : "未选择模板")}
                  </td>
                  <td>{badge(item)}</td>
                  <td>
                    {item.final_version ? (
                      <span className="summary-final-version">
                        v{item.final_version}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {onOpenNode && (
                      <button
                        onClick={() =>
                          onOpenNode(item.node_id, item.output_id ?? undefined)
                        }
                      >
                        <FolderOpen size={16} />
                        打开节点
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!items.length && (
          <p className="acceptance-empty">
            没有匹配的节点。当前仅视频节点提供动作迁移验收。
          </p>
        )}
      </section>
      {current && (
        <aside className="acceptance-surface acceptance-summary-detail">
          <div className="acceptance-summary-detail-title">
            {current.output_asset_id && (
              <AcceptanceThumbnail
                assetId={current.output_asset_id}
                kind={current.kind}
                alt=""
              />
            )}
            <div>
              <h2>{current.title}</h2>
              {badge(current)}
            </div>
          </div>
          {scheme && (
            <div className="acceptance-summary-scheme">
              <span className="acceptance-model-icon">
                <SchemeIcon scheme={scheme} />
              </span>
              <div>
                <strong>
                  {scheme.title} · {scheme.connection_label}
                </strong>
                <p>使用节点上下文与媒体资料进行定制检查。</p>
              </div>
            </div>
          )}
          <div className="acceptance-summary-previews">
            <SummaryMedia asset={motion?.asset_id} label="原动作视频" />
            <SummaryMedia
              asset={current.output_asset_id ?? undefined}
              label={`输出 ${current.output_version ? `v${current.output_version}` : "—"}`}
            />
          </div>
          <h3>验收报告</h3>
          <p className="acceptance-summary-report">
            {current.issue ||
              current.run?.error_message ||
              report?.summary ||
              "暂无已确认的问题。"}
          </p>
          {start != null && end != null && duration > 0 && (
            <div className="acceptance-summary-interval">
              <p>
                <strong>问题区间</strong>
                <span>
                  {time(start)} — {time(end)}
                </span>
              </p>
              <div>
                <span
                  style={{
                    left: `${Math.min(100, (start / duration) * 100)}%`,
                    width: `${Math.min(100, ((end - start) / duration) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {run && onOpenNode && (
            <div className="acceptance-summary-links">
              <button onClick={open}>
                <Image size={17} />
                证据截图 · {run.evidence.length} 张<ArrowRight size={14} />
              </button>
              <button onClick={open}>
                <FileText size={17} />
                完整报告
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          <footer>
            <p>
              <ShieldCheck size={17} />
              {run?.status === "completed"
                ? "已完成检查，AI 建议需人工确认。"
                : "验收结果独立保存，不影响输出采用。"}
            </p>
            <p>
              <Info size={17} />
              最终输出
              {current.final_version
                ? `仍为 v${current.final_version}`
                : "尚未设置"}
              。
            </p>
            {onOpenNode && (
              <button className="acceptance-primary" onClick={open}>
                <FolderOpen size={18} />
                打开节点处理
              </button>
            )}
            <small>在节点内查看证据、返修并复验。</small>
          </footer>
        </aside>
      )}
    </div>
  );
}
