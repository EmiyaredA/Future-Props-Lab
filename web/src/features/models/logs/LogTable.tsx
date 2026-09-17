import { ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CatalogMenu } from "@features/models/catalog/CatalogMenu";
import type { CallLogItem } from "@features/models/api";
import { providerLabels } from "./logOptions";
import { formatNumber, sourceLabels } from "./modelCallLogPresentation";
export type LogRow = Omit<CallLogItem, "trace_id"> & { workspace_id?: string };
export function LogTable({
  rows,
  local,
  canDelete,
  all,
  workspaces,
  selected,
  onSelect,
  onView,
  onDelete,
}: {
  rows: LogRow[];
  local: boolean;
  canDelete: boolean;
  all: boolean;
  workspaces: { id: string; name: string }[];
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  onView: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="call-log-table-wrap"
      tabIndex={0}
      role="region"
      aria-label="调用日志表格"
    >
      <table className="call-log-table">
        <thead>
          <tr>
            {canDelete && (
              <th className="call-log-check">
                <input
                  type="checkbox"
                  aria-label="全选当前页日志"
                  checked={
                    rows.length > 0 && rows.every((row) => selected.has(row.id))
                  }
                  onChange={(e) =>
                    onSelect(
                      rows.map((x) => x.id),
                      e.target.checked,
                    )
                  }
                />
              </th>
            )}
            <th aria-sort="descending">
              时间 <ArrowDown size={12} />
            </th>
            {all && <th>工作区</th>}
            <th>调用源</th>
            <th>模型</th>
            <th>接入协议</th>
            <th className="call-log-num">Token</th>
            <th className="call-log-num">耗时</th>
            <th className="call-log-status">状态</th>
            {local && <th className="call-log-actions">操作</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const date = new Date(row.created_at);
            return (
              <tr key={row.id}>
                {canDelete && (
                  <td className="call-log-check">
                    <input
                      type="checkbox"
                      aria-label={`选择日志 ${row.id}`}
                      checked={selected.has(row.id)}
                      onChange={(e) => onSelect([row.id], e.target.checked)}
                    />
                  </td>
                )}
                <td>
                  <time dateTime={row.created_at}>
                    {date.toLocaleDateString("zh-CN")}
                    <br />
                    {date.toLocaleTimeString("zh-CN", { hour12: false })}
                  </time>
                </td>
                {all && (
                  <td>
                    {workspaces.find((x) => x.id === row.workspace_id)?.name ??
                      "—"}
                  </td>
                )}
                <td>{sourceLabels[row.call_source] ?? row.call_source}</td>
                <td className="call-log-model">
                  <strong title={row.model}>{row.model}</strong>
                </td>
                <td>
                  {providerLabels[row.provider_kind] ?? row.provider_kind}
                </td>
                <td className="call-log-num">
                  {formatNumber(row.total_tokens)}
                </td>
                <td className="call-log-num">
                  {formatNumber(row.latency_ms)} ms
                </td>
                <td className="call-log-status">
                  <span
                    className={`status ${row.status === "success" ? "success" : "error"}`}
                  >
                    {row.status === "success" ? "成功" : "失败"}
                  </span>
                </td>
                {local && (
                  <td className="call-log-actions">
                    <div>
                      <button
                        className="text-btn"
                        onClick={() => onView(row.id)}
                      >
                        查看
                      </button>
                      {canDelete && (
                        <CatalogMenu
                          label={`日志 ${row.id} 操作`}
                          items={[
                            {
                              label: "删除日志",
                              danger: true,
                              onClick: () => onDelete(row.id),
                            },
                          ]}
                        />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function LogPagination({
  total,
  page,
  pageSize,
  onPage,
  onSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const numbers = Array.from(
    new Set(
      [1, pages, page - 1, page, page + 1].filter((x) => x > 0 && x <= pages),
    ),
  ).sort((a, b) => a - b);
  return (
    <footer className="call-log-pagination">
      <span>共 {formatNumber(total)} 条</span>
      <div>
        <CustomSelect
          ariaLabel="每页条数"
          value={String(pageSize)}
          options={[25, 50, 100].map((value) => ({
            value: String(value),
            label: `${value} 条/页`,
          }))}
          onChange={(value) => onSize(Number(value))}
        />
        <button
          className="btn icon-btn"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        {numbers.map((value, index) => (
          <span className="call-log-page-number" key={value}>
            {index > 0 && value > numbers[index - 1] + 1 && <span>…</span>}
            <button
              className={`btn ${page === value ? "primary" : ""}`}
              aria-label={`第 ${value} 页`}
              aria-current={page === value ? "page" : undefined}
              onClick={() => onPage(value)}
            >
              {value}
            </button>
          </span>
        ))}
        <button
          className="btn icon-btn"
          aria-label="下一页"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </footer>
  );
}
