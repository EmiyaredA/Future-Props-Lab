import { Search, ArrowRight } from "lucide-react";
import { useDebouncedValue } from "./useDebouncedValue";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { type AccountSessionContext } from "./api";
import {
  createManagedWorkspace,
  fetchManagedAccounts,
  fetchManagedWorkspaces,
  type WorkspaceFilters,
} from "./managementApi";
import { accountQueryKeys } from "./queryKeys";
import {
  ManagementDialog,
  ManagementError,
  ManagementPagination,
} from "./ManagementUi";
export function ManagedWorkspacesPage({
  session,
}: {
  session: AccountSessionContext;
}) {
  const cache = useQueryClient();
  const [filters, setFilters] = useState<WorkspaceFilters>({
    q: "",
    page: 1,
    page_size: 25,
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("");
  const settledFilters = useDebouncedValue(filters);
  const query = useQuery({
    queryKey: accountQueryKeys.workspaces(settledFilters),
    queryFn: () => fetchManagedWorkspaces(settledFilters),
  });
  const settledOwnerQuery = useDebouncedValue(ownerQuery);
  const ownerFilters = {
    q: settledOwnerQuery,
    status: "active" as const,
    page: 1,
    page_size: 25,
  };
  const owners = useQuery({
    queryKey: accountQueryKeys.accounts(ownerFilters),
    queryFn: () => fetchManagedAccounts(ownerFilters),
    enabled: open,
  });
  const create = useMutation({
    mutationFn: () =>
      createManagedWorkspace({
        name: name.trim(),
        owner_user_id: ownerId,
        visibility: "private",
      }),
    onSuccess: () => {
      setOpen(false);
      setName("");
      setOwnerId("");
      setOwnerLabel("");
      void cache.invalidateQueries({ queryKey: accountQueryKeys.platform });
    },
  });
  const enter = useMutation({
    mutationFn: (id: string) => session.switchWorkspace(id),
  });
  return (
    <section className="management-page">
      <header className="management-page-head">
        <div>
          <h1>工作区管理</h1>
          <p>创建独立空间，通过成员邀请共享内容和协作权限。</p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            create.reset();
            setOpen(true);
          }}
        >
          创建工作区
        </button>
      </header>
      <div className="management-list-panel">
        <div className="management-toolbar">
          <label className="management-search">
            <Search size={18} />
            <input
              aria-label="搜索工作区"
              placeholder="空间名称或拥有者"
              value={filters.q}
              onChange={(e) =>
                setFilters({ ...filters, q: e.target.value, page: 1 })
              }
            />
          </label>
          <CustomSelect
            ariaLabel="工作区可见性"
            value={filters.visibility || ""}
            options={[
              { value: "", label: "全部空间" },
              { value: "private", label: "私有" },
              { value: "public", label: "公开展台" },
            ]}
            onChange={(v) =>
              setFilters({
                ...filters,
                visibility: v ? (v as "private" | "public") : undefined,
                page: 1,
              })
            }
          />
        </div>
        <ManagementError error={query.error || enter.error} />
        {query.isPending ? <p role="status">正在加载工作区…</p> : null}
        {query.isError ? (
          <button className="btn" onClick={() => void query.refetch()}>
            重试
          </button>
        ) : null}
        <div className="management-table-wrap management-responsive-table">
          <table>
            <thead>
              <tr>
                <th>工作区</th>
                <th>拥有者</th>
                <th>访问范围</th>
                <th>成员数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.items.map((w) => (
                <tr key={w.id}>
                  <td>
                    <strong>{w.name}</strong>
                    {w.id === session.me.workspace.id ? (
                      <small>当前工作区</small>
                    ) : null}
                  </td>
                  <td>
                    {w.owner_display_name}
                    <small>@{w.owner_username}</small>
                  </td>
                  <td>{w.visibility === "private" ? "私有" : "公开展台"}</td>
                  <td>{w.member_count}</td>
                  <td>
                    {w.id === session.me.workspace.id ? (
                      <button
                        className="btn small"
                        onClick={() =>
                          window.dispatchEvent(
                            new Event("future-props:open-workspace"),
                          )
                        }
                      >
                        空间设置与成员
                      </button>
                    ) : (
                      <button
                        className="btn small"
                        disabled={enter.isPending}
                        onClick={() => enter.mutate(w.id)}
                      >
                        进入工作区 <ArrowRight size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.data?.total === 0 ? (
          <p className="empty-copy">没有匹配的工作区。</p>
        ) : null}
        <ManagementPagination
          total={query.data?.total ?? 0}
          page={filters.page}
          setPage={(page) => setFilters({ ...filters, page })}
        />
      </div>
      {open ? (
        <ManagementDialog
          title="创建工作区"
          close={() => setOpen(false)}
          pending={create.isPending}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <label>
              工作区名称
              <input
                required
                maxLength={255}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              查找拥有者
              <input
                aria-label="查找拥有者"
                placeholder="搜索启用账号的用户名或邮箱"
                value={ownerQuery}
                onChange={(e) => setOwnerQuery(e.target.value)}
              />
            </label>
            <div className="management-owner-options">
              {owners.data?.items.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  aria-pressed={ownerId === a.id}
                  className={`btn ${ownerId === a.id ? "primary" : ""}`}
                  onClick={() => {
                    setOwnerId(a.id);
                    setOwnerLabel(`@${a.username}`);
                  }}
                >
                  {a.display_name} · @{a.username}
                </button>
              ))}
            </div>
            <p>
              {ownerLabel
                ? `已选择 ${ownerLabel}`
                : "选择一个启用账号作为拥有者；可通过搜索缩小范围。"}
            </p>
            <p>
              默认私有，初始化独立模型目录。创建后可在空间设置中调整访问范围。
            </p>
            <ManagementError error={create.error || owners.error} />
            <button
              className="btn primary"
              disabled={!ownerId || !name.trim() || create.isPending}
            >
              {create.isPending ? "正在创建…" : "创建工作区"}
            </button>
          </form>
        </ManagementDialog>
      ) : null}
    </section>
  );
}
