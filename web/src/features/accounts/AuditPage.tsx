import { SlidersHorizontal, X } from "lucide-react";
import { useDebouncedValue } from "./useDebouncedValue";
import { formatAccountDate } from "./formatAccountDate";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomDateInput } from "@shared/ui/CustomDateInput";
import { accountQueryKeys } from "./queryKeys";
import { fetchAudit } from "./managementApi";
import { ManagementError, ManagementPagination } from "./ManagementUi";
import { auditLabels, metadataLabels } from "./auditLabels";
export function AuditPage({
  workspaceId = null,
}: {
  workspaceId?: string | null;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [event, setEvent] = useState("");
  const [actor, setActor] = useState("");
  const [target, setTarget] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const validDate = (s: string) =>
    !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)));
  const valid =
    validDate(from) && validDate(to) && (!from || !to || from <= to);
  const settledActor = useDebouncedValue(actor);
  const settledTarget = useDebouncedValue(target);
  const filters = {
    event_type: event,
    actor_query: settledActor,
    target_query: settledTarget,
    from_date:
      from && valid ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to_date:
      to && valid ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    page,
    page_size: 25,
  };
  const query = useQuery({
    queryKey: accountQueryKeys.audit(workspaceId, filters),
    queryFn: () => fetchAudit(workspaceId, filters),
    enabled: valid,
  });
  const detail = query.data?.items.find((item) => item.id === detailId);
  function update(set: (v: string) => void, value: string) {
    set(value);
    setPage(1);
  }
  return (
    <section className="management-page">
      <header className="management-page-head">
        <div>
          <h1>{workspaceId ? "工作区审计" : "安全审计"}</h1>
          <p>
            {workspaceId
              ? "仅展示当前空间内的管理事件。"
              : "查询平台账号与工作区治理记录。"}
          </p>
        </div>
      </header>
      <div className="management-list-panel">
        <div className="management-toolbar">
          <CustomSelect
            ariaLabel="事件类型"
            value={event}
            options={[
              { value: "", label: "全部事件" },
              ...Object.entries(auditLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            onChange={(v) => update(setEvent, v)}
          />
          <input
            aria-label="操作者"
            placeholder="操作者用户名"
            value={actor}
            onChange={(e) => update(setActor, e.target.value)}
          />
          <input
            aria-label="目标账号"
            placeholder="目标账号用户名"
            value={target}
            onChange={(e) => update(setTarget, e.target.value)}
          />
          <button
            className="btn"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <SlidersHorizontal size={16} />
            时间范围{from || to ? " · 已设置" : ""}
          </button>
        </div>
        {advanced ? (
          <div className="management-advanced-filters">
            {" "}
            <CustomDateInput
              ariaLabel="开始日期"
              value={from}
              onChange={(v) => update(setFrom, v)}
            />
            <CustomDateInput
              ariaLabel="结束日期"
              value={to}
              onChange={(v) => update(setTo, v)}
            />
          </div>
        ) : null}
        {!valid ? (
          <p role="alert">请输入有效日期，开始日期不能晚于结束日期。</p>
        ) : null}
        <ManagementError error={query.error} />
        {query.isLoading ? <p role="status">正在加载审计记录…</p> : null}
        {query.isError ? (
          <button className="btn" onClick={() => void query.refetch()}>
            重试
          </button>
        ) : null}
        <div className="management-table-wrap">
          <table>
            <thead>
              <tr>
                <th>事件</th>
                <th>操作者</th>
                <th>目标账号</th>
                <th>时间</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    {auditLabels[e.event_type] || "安全事件"}
                    <small>{e.outcome === "success" ? "成功" : "失败"}</small>
                  </td>
                  <td>{e.actor_username || "系统"}</td>
                  <td>{e.target_username || "—"}</td>
                  <td>{formatAccountDate(e.created_at)}</td>
                  <td>
                    <button
                      className="btn small"
                      aria-expanded={detailId === e.id}
                      onClick={() =>
                        setDetailId(detailId === e.id ? null : e.id)
                      }
                    >
                      查看详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail ? (
          <section className="management-audit-detail" aria-label="审计详情">
            <header>
              <h3>{auditLabels[detail.event_type] || "安全事件"}</h3>
              <button
                className="icon-button"
                aria-label="关闭审计详情"
                onClick={() => setDetailId(null)}
              >
                <X size={18} />
              </button>
            </header>{" "}
            <dl>
              <dt>事件标识</dt>
              <dd>{detail.event_type}</dd>
              <dt>工作区</dt>
              <dd>{detail.workspace_id || "平台"}</dd>
              {Object.entries(detail.metadata).map(([key, value]) => (
                <div key={key}>
                  <dt>{metadataLabels[key] || key}</dt>
                  <dd>
                    {typeof value === "boolean"
                      ? value
                        ? "是"
                        : "否"
                      : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        {query.data?.total === 0 ? (
          <p className="empty-copy">没有匹配的审计记录。</p>
        ) : null}
        <ManagementPagination
          total={query.data?.total ?? 0}
          page={page}
          setPage={setPage}
        />
      </div>
    </section>
  );
}
