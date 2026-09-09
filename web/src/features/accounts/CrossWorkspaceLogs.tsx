import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { accountQueryKeys } from "./queryKeys";
import { fetchLogWorkspaces, fetchCrossWorkspaceLogs } from "./platformApi";
import {
  ManagementDialog,
  ManagementError,
  ManagementPagination,
} from "./ManagementUi";
import { formatAccountDate } from "./formatAccountDate";
import { useDebouncedValue } from "./useDebouncedValue";
export function CrossWorkspaceLogs() {
  const allowed = useWorkspacePermission("logs.cross_workspace");
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <div className="governance-cross-logs">
      <button className="btn" onClick={() => setOpen(true)}>
        跨工作区查询
      </button>
      {open && <LogBrowser close={() => setOpen(false)} />}
    </div>
  );
}
function LogBrowser({ close }: { close: () => void }) {
  const [workspace, setWorkspace] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const spaces = useQuery({
    queryKey: accountQueryKeys.logWorkspaces,
    queryFn: fetchLogWorkspaces,
  });
  const logs = useQuery({
    queryKey: accountQueryKeys.crossLogs(workspace, q, page),
    queryFn: () => fetchCrossWorkspaceLogs(workspace, q, page),
    enabled: !!workspace,
  });
  return (
    <ManagementDialog title="跨工作区调用概况" close={close}>
      <p>显式选择需要查看的工作区，不会切换当前工作区。</p>
      <div className="management-toolbar">
        <CustomSelect
          ariaLabel="日志工作区"
          value={workspace}
          options={[
            { value: "", label: "选择工作区" },
            ...(spaces.data || []).map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
          onChange={(value) => {
            setWorkspace(value);
            setPage(1);
          }}
        />
        <input
          aria-label="搜索跨空间调用"
          placeholder="模型或调用来源"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>
      <ManagementError error={spaces.error || logs.error} />
      {(spaces.isError || logs.isError) && (
        <button
          className="btn"
          onClick={() => {
            void spaces.refetch();
            if (workspace) void logs.refetch();
          }}
        >
          重试
        </button>
      )}
      {logs.isFetching ? (
        <p role="status">正在读取调用记录…</p>
      ) : !workspace ? (
        <p className="empty-copy">选择工作区后显示记录</p>
      ) : (
        <div className="management-table-wrap">
          <table className="management-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>调用来源</th>
                <th>状态</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {logs.data?.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.model}</td>
                  <td>{item.call_source}</td>
                  <td>{item.status === "success" ? "成功" : "失败"}</td>
                  <td>{formatAccountDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.data?.total === 0 && (
            <p className="empty-copy">没有匹配的调用记录</p>
          )}
        </div>
      )}
      {logs.data && (
        <ManagementPagination
          page={page}
          total={logs.data.total}
          pageSize={25}
          setPage={setPage}
        />
      )}
      <footer>
        <button className="btn" onClick={close}>
          关闭
        </button>
      </footer>
    </ManagementDialog>
  );
}
