import { ArrowRight, Check, ChevronDown, Clock3, ScrollText, X } from "lucide-react";
import type { fetchAudit } from "./managementApi";
import { auditLabels, metadataLabels } from "./auditLabels";
import { formatAccountDate } from "./formatAccountDate";

type AuditRecord = Awaited<ReturnType<typeof fetchAudit>>["items"][number];

export function WorkspaceAuditRecords({
  items,
  detailId,
  setDetailId,
}: {
  items: AuditRecord[];
  detailId: string | null;
  setDetailId: (id: string | null) => void;
}) {
  return (
    <div className="workspace-audit-records">
      <header className="workspace-audit-list-heading">
        <h3>操作记录</h3>
        <span>当前工作空间</span>
      </header>
      {items.map((record) => {
        const expanded = detailId === record.id;
        const success = record.outcome === "success";
        return (
          <article className="workspace-audit-record" key={record.id}>
            <header>
              <span className="workspace-audit-event-icon" aria-hidden="true">
                <ScrollText size={20} />
              </span>
              <h3>{auditLabels[record.event_type] || "安全事件"}</h3>
              <span className={`workspace-audit-outcome ${success ? "is-success" : "is-failure"}`}>
                {success ? <Check size={12} /> : <X size={12} />}
                {success ? "成功" : "失败"}
              </span>
            </header>
            <div className="workspace-audit-people">
              <div><span>操作者</span><strong>{record.actor_username || "系统"}</strong></div>
              <ArrowRight size={16} aria-hidden="true" />
              <div><span>目标账号</span><strong>{record.target_username || "—"}</strong></div>
            </div>
            <footer>
              <span className="workspace-audit-time"><Clock3 size={14} aria-hidden="true" />{formatAccountDate(record.created_at)}</span>
              <button
                className="workspace-audit-detail-toggle"
                aria-expanded={expanded}
                aria-controls={`audit-detail-${record.id}`}
                onClick={() => setDetailId(expanded ? null : record.id)}
              >
                {expanded ? "收起详情" : "查看详情"}<ChevronDown size={15} />
              </button>
            </footer>
            {expanded ? (
              <section className="workspace-audit-detail" id={`audit-detail-${record.id}`} aria-label="审计详情">
                <dl>
                  {Object.entries(record.metadata).map(([key, value]) => (
                    <div key={key}><dt>{metadataLabels[key] || key}</dt><dd>{typeof value === "boolean" ? value ? "是" : "否" : String(value)}</dd></div>
                  ))}
                  <div><dt>事件标识</dt><dd>{record.event_type}</dd></div>
                  <div><dt>工作空间</dt><dd>{record.workspace_id || "平台"}</dd></div>
                </dl>
              </section>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
