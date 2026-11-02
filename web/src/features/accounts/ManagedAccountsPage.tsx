import { LoadingState } from "@shared/ui/LoadingState";
import {
  platformRoleLabels,
  platformRoleOptions,
  type PlatformRole,
} from "./platformApi";
import { AccountStatistics } from "./AccountStatistics";
import { AccountActionMenu } from "./AccountMenu";
import { Search, MoreHorizontal } from "lucide-react";
import { useDebouncedValue } from "./useDebouncedValue";
import { formatAccountDate } from "./formatAccountDate";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { type ManagedAccount, resetPlatformAccountPassword } from "./api";
import {
  createManagedAccount,
  fetchManagedAccounts,
  patchManagedAccount,
  type AccountFilters,
} from "./managementApi";
import { accountQueryKeys } from "./queryKeys";
import {
  ManagementDialog,
  ManagementError,
  ManagementPagination,
} from "./ManagementUi";
export function ManagedAccountsPage({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const createButton = useRef<HTMLButtonElement>(null);
  const [filters, setFilters] = useState<AccountFilters>({
    q: "",
    page: 1,
    page_size: 25,
  });
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    username: "",
    display_name: "",
    email: "",
    platform_role: "user" as PlatformRole,
  });
  const [secret, setSecret] = useState<{
    username: string;
    value: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<unknown>(null);
  const [action, setAction] = useState<{
    account: ManagedAccount;
    kind: "status" | "role" | "password";
    nextRole?: PlatformRole;
  } | null>(null);
  const settledFilters = useDebouncedValue(filters);
  const query = useQuery({
    queryKey: accountQueryKeys.accounts(settledFilters),
    queryFn: () => fetchManagedAccounts(settledFilters),
  });
  const reload = () =>
    cache.invalidateQueries({ queryKey: accountQueryKeys.platform });
  const create = useMutation({
    gcTime: 0,
    mutationFn: () =>
      createManagedAccount({
        ...draft,
        is_platform_admin: draft.platform_role === "admin",
      }),
    onSuccess: (result) => {
      setCreating(false);
      setDraft({
        username: "",
        display_name: "",
        email: "",
        platform_role: "user" as PlatformRole,
      });
      setSecret({
        username: result.account.username,
        value: result.temporary_password,
      });
      setCopied(false);
      void reload();
    },
  });
  const change = useMutation({
    gcTime: 0,
    mutationFn: async () => {
      if (!action) return;
      const { account, kind } = action;
      if (kind === "password") return resetPlatformAccountPassword(account);
      await patchManagedAccount(account.id, {
        expected_revision: account.revision,
        ...(kind === "status"
          ? { status: account.status === "active" ? "disabled" : "active" }
          : { platform_role: action.nextRole }),
      });
    },
    onSuccess: (result) => {
      if (result) {
        setSecret({
          username: result.account.username,
          value: result.temporary_password,
        });
        setCopied(false);
      }
      setAction(null);
      void reload();
    },
    onError: () => {
      setAction(null);
      void reload();
    },
  });
  const filter = (patch: Partial<AccountFilters>) =>
    setFilters((old) => ({ ...old, ...patch, page: 1 }));
  return (
    <section className="management-page">
      <header className="management-page-head">
        <div>
          <h1>账号管理</h1>
          <p>管理登录资格与平台身份。私人数据按账号隔离。</p>
        </div>
        <button
          className="btn primary"
          ref={createButton}
          onClick={() => {
            create.reset();
            setCreating(true);
          }}
        >
          创建账号
        </button>
      </header>
      <AccountStatistics />
      <div className="management-list-panel">
        <div className="management-toolbar">
          <label className="management-search">
            <Search size={18} />
            <input
              aria-label="搜索账号"
              placeholder="用户名、展示名或邮箱"
              value={filters.q}
              onChange={(e) => filter({ q: e.target.value })}
            />
          </label>
          <CustomSelect
            ariaLabel="账号状态"
            value={filters.status || ""}
            options={[
              { value: "", label: "全部状态" },
              { value: "active", label: "已启用" },
              { value: "disabled", label: "已禁用" },
            ]}
            onChange={(v) =>
              filter({ status: v ? (v as "active" | "disabled") : undefined })
            }
          />
          <CustomSelect
            ariaLabel="平台身份"
            value={filters.platform_role || ""}
            options={[{ value: "", label: "全部身份" }, ...platformRoleOptions]}
            onChange={(value) =>
              filter({
                platform_role: value ? (value as PlatformRole) : undefined,
              })
            }
          />
        </div>
        <ManagementError error={query.error || change.error} />
        {query.isPending ? (
          <LoadingState label="正在加载账号…" variant="region" />
        ) : null}
        {query.isError ? (
          <button className="btn" onClick={() => void query.refetch()}>
            重试
          </button>
        ) : null}
        <div className="management-table-wrap management-responsive-table">
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th>平台身份</th>
                <th>状态</th>
                <th>最近登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.items.map((a) => (
                <tr key={a.id}>
                  <td data-label="账号">
                    <div className="management-account-cell">
                      <span className="account-identity-avatar">
                        {a.display_name.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{a.display_name}</strong>
                        <small>
                          @{a.username}
                          {a.id === userId ? " · 当前账号" : ""}
                        </small>
                        <small>{a.email || "未填写邮箱"}</small>
                      </span>
                    </div>
                  </td>
                  <td data-label="平台身份">
                    {
                      platformRoleLabels[
                        a.platform_role ||
                          (a.is_platform_admin ? "admin" : "user")
                      ]
                    }
                  </td>
                  <td data-label="状态">
                    <span
                      className={`management-status ${a.status === "active" ? "is-active" : "is-disabled"}`}
                    >
                      {a.status === "active" ? "已启用" : "已禁用"}
                    </span>
                    {a.must_change_password ? (
                      <small>首次登录需改密</small>
                    ) : null}
                  </td>
                  <td data-label="最近登录">
                    {formatAccountDate(a.last_login_at)}
                  </td>
                  <td>
                    {a.id === userId ? (
                      <span className="management-protected">当前账号</span>
                    ) : (
                      <AccountActionMenu
                        label={`管理 ${a.username}`}
                        trigger={<MoreHorizontal size={20} />}
                        items={[
                          ...platformRoleOptions
                            .filter(
                              (option) => option.value !== a.platform_role,
                            )
                            .map((option) => ({
                              label: `设为${option.label}`,
                              disabled: change.isPending,
                              action: () =>
                                setAction({
                                  account: a,
                                  kind: "role" as const,
                                  nextRole: option.value as PlatformRole,
                                }),
                            })),
                          {
                            label: "重置密码",
                            disabled: change.isPending,
                            action: () =>
                              setAction({ account: a, kind: "password" }),
                          },
                          {
                            label: a.status === "active" ? "禁用" : "恢复",
                            danger: a.status === "active",
                            disabled: change.isPending,
                            action: () =>
                              setAction({ account: a, kind: "status" }),
                          },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.data?.total === 0 ? (
          <p className="empty-copy">没有匹配的账号，请调整搜索条件。</p>
        ) : null}
        <ManagementPagination
          total={query.data?.total ?? 0}
          page={filters.page}
          setPage={(page) => setFilters({ ...filters, page })}
        />
      </div>
      <ConfirmDialog
        open={!!action}
        title={
          action?.kind === "password" ? "重置账号密码" : "修改账号权限或状态"
        }
        description={`确认修改 @${action?.account.username || ""}？密码重置、身份变更或禁用会撤销该账号已有会话和密钥。`}
        pending={change.isPending}
        onCancel={() => setAction(null)}
        onConfirm={() => change.mutate()}
      />
      {creating ? (
        <ManagementDialog
          title="创建账号"
          close={() => setCreating(false)}
          pending={create.isPending}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <label>
              用户名
              <input
                required
                maxLength={64}
                value={draft.username}
                onChange={(e) =>
                  setDraft({ ...draft, username: e.target.value })
                }
                autoComplete="off"
              />
            </label>
            <label>
              展示名
              <input
                maxLength={120}
                value={draft.display_name}
                onChange={(e) =>
                  setDraft({ ...draft, display_name: e.target.value })
                }
              />
            </label>
            <label>
              邮箱
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </label>
            <CustomSelect
              ariaLabel="新账号平台身份"
              value={draft.platform_role}
              options={platformRoleOptions}
              onChange={(value) =>
                setDraft({ ...draft, platform_role: value as PlatformRole })
              }
            />
            <p>首次登录需设置新密码。</p>
            <ManagementError error={create.error} />
            <button className="btn primary" disabled={create.isPending}>
              {create.isPending ? "正在创建…" : "创建账号"}
            </button>
          </form>
        </ManagementDialog>
      ) : null}
      {secret ? (
        <ManagementDialog
          title="临时密码只显示一次"
          close={() => {
            setSecret(null);
            setCopyError(null);
            create.reset();
            change.reset();
            queueMicrotask(() => createButton.current?.focus());
          }}
        >
          <p>
            请将 @{secret.username}{" "}
            的临时密码通过可信渠道交付，关闭后无法再次查看。
          </p>
          <div className="secret-once">
            <code>{secret.value}</code>
          </div>
          <ManagementError error={copyError} />
          <button
            className="btn primary"
            onClick={() => {
              void navigator.clipboard
                .writeText(secret.value)
                .then(() => setCopied(true))
                .catch(setCopyError);
            }}
          >
            {copied ? "已复制" : "复制临时密码"}
          </button>
        </ManagementDialog>
      ) : null}
    </section>
  );
}
