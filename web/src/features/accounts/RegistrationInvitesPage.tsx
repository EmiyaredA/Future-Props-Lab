import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { AccountActionMenu } from "./AccountMenu";
import {
  ManagementDialog,
  ManagementError,
  ManagementPagination,
} from "./ManagementUi";
import { reauthenticate } from "./api";
import { accountQueryKeys } from "./queryKeys";
import { useDebouncedValue } from "./useDebouncedValue";
import { formatAccountDate } from "./formatAccountDate";
import {
  actOnInviteCode,
  createInviteCode,
  fetchInviteCodes,
  fetchRedemptions,
  patchInviteCode,
  revealInviteCode,
  type InviteCode,
} from "./platformApi";
const statuses = {
  active: "可使用",
  disabled: "已停用",
  expired: "已过期",
  exhausted: "名额已用完",
  deleted: "已删除",
};
type Action = {
  row: InviteCode;
  kind: "quota" | "extend" | "reset_expiry" | "delete" | "toggle" | "reveal";
};
export function RegistrationInvitesPage() {
  const cache = useQueryClient();
  const [filters, setFilters] = useState({
    q: "",
    status: "",
    page: 1,
    page_size: 25,
  });
  const settled = useDebouncedValue(filters);
  const query = useQuery({
    queryKey: accountQueryKeys.invites(settled),
    queryFn: () => fetchInviteCodes(settled),
  });
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    max_uses: 1,
    validity_days: 7,
  });
  const [action, setAction] = useState<Action | null>(null);
  const [amount, setAmount] = useState(7);
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState("");
  const [history, setHistory] = useState<InviteCode | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const redemptions = useQuery({
    queryKey: accountQueryKeys.redemptions(history?.id || "", historyPage),
    queryFn: () => fetchRedemptions(history!.id, historyPage),
    enabled: !!history,
  });
  const close = () => {
    setCreating(false);
    setAction(null);
    setPassword("");
    setSecret("");
    setError(null);
  };
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await cache.invalidateQueries({ queryKey: accountQueryKeys.platform });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  const apply = () =>
    perform(async () => {
      if (!action) return;
      const { row, kind } = action;
      if (kind === "reveal") {
        await reauthenticate(password);
        setPassword("");
        const result = await revealInviteCode(row.id);
        setAction(null);
        setSecret(result.secret);
        return;
      }
      if (kind === "quota" || kind === "toggle")
        await patchInviteCode(row.id, {
          expected_revision: row.revision,
          ...(kind === "quota"
            ? { max_uses: amount }
            : { enabled: !row.enabled }),
        });
      else
        await actOnInviteCode(row.id, {
          action: kind,
          days: amount,
          expected_revision: row.revision,
        });
      close();
    });
  return (
    <section className="management-page">
      <header className="management-page-head">
        <div>
          <h1>邀请码管理</h1>
          <p>通过邀请码开放注册，控制名额与有效期。</p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            setError(null);
            setCreating(true);
          }}
        >
          <Plus size={17} />
          创建邀请码
        </button>
      </header>
      <div className="management-list-panel">
        <div className="management-toolbar">
          <label className="management-search">
            <Search size={18} />
            <input
              aria-label="搜索邀请码"
              placeholder="搜索邀请码名称"
              value={filters.q}
              onChange={(e) =>
                setFilters({ ...filters, q: e.target.value, page: 1 })
              }
            />
          </label>
          <CustomSelect
            ariaLabel="邀请码状态"
            value={filters.status}
            options={[
              { value: "", label: "全部未删除" },
              ...Object.entries(statuses).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            onChange={(status) => setFilters({ ...filters, status, page: 1 })}
          />
        </div>
        <ManagementError error={query.error} />
        {query.isError && (
          <button className="btn" onClick={() => void query.refetch()}>
            重新加载
          </button>
        )}
        {query.isPending ? (
          <p className="empty-copy">正在加载邀请码…</p>
        ) : (
          <div className="management-table-wrap management-responsive-table">
            <table className="management-table">
              <thead>
                <tr>
                  <th>邀请码</th>
                  <th>状态</th>
                  <th>使用名额</th>
                  <th>有效期至</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.items.map((row) => (
                  <tr key={row.id}>
                    <td data-label="邀请码">
                      <strong>{row.name}</strong>
                      <small>{row.code_hint}</small>
                    </td>
                    <td data-label="状态">
                      <span
                        className={`management-status ${row.status === "active" ? "is-active" : "is-disabled"}`}
                      >
                        {statuses[row.status]}
                      </span>
                    </td>
                    <td data-label="名额">
                      {row.used_count} / {row.max_uses}
                    </td>
                    <td data-label="有效期">
                      {formatAccountDate(row.expires_at)}
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          className="btn small"
                          onClick={() => {
                            setHistory(row);
                            setHistoryPage(1);
                          }}
                        >
                          兑换记录
                        </button>
                        {row.status !== "deleted" && (
                          <AccountActionMenu
                            label={`管理邀请码 ${row.name}`}
                            trigger={<MoreHorizontal size={19} />}
                            items={(
                              [
                                ["reveal", "查看邀请码"],
                                ["quota", "调整名额"],
                                ["extend", "延长有效期"],
                                ["reset_expiry", "重设有效期"],
                                ["toggle", row.enabled ? "停用" : "启用"],
                                ["delete", "删除邀请码"],
                              ] as const
                            ).map(([kind, label]) => ({
                              label,
                              danger: kind === "delete",
                              action: () => {
                                setError(null);
                                setAmount(kind === "quota" ? row.max_uses : 7);
                                setAction({ row, kind });
                              },
                            }))}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.data?.total === 0 && (
          <p className="empty-copy">
            {filters.q || filters.status
              ? "没有匹配的邀请码。"
              : "暂无邀请码，创建后即可邀请用户注册。"}
          </p>
        )}
        <ManagementPagination
          total={query.data?.total || 0}
          page={filters.page}
          setPage={(page) => setFilters({ ...filters, page })}
        />
      </div>
      {creating && (
        <ManagementDialog title="创建邀请码" close={close} pending={busy}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                const result = await createInviteCode(draft);
                setCreating(false);
                setDraft({ name: "", max_uses: 1, validity_days: 7 });
                setSecret(result.secret);
              });
            }}
          >
            <p>兑换成功后创建普通用户账号与个人工作区。</p>
            <label>
              名称
              <input
                required
                value={draft.name}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <div className="governance-form-grid">
              <label>
                注册名额
                <input
                  type="number"
                  min={1}
                  max={10000}
                  required
                  value={draft.max_uses}
                  onChange={(e) =>
                    setDraft({ ...draft, max_uses: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                有效天数
                <input
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={draft.validity_days}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      validity_days: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <ManagementError error={error} />
            <footer>
              <button type="button" className="btn" onClick={close}>
                取消
              </button>
              <button className="btn primary" disabled={busy}>
                创建邀请码
              </button>
            </footer>
          </form>
        </ManagementDialog>
      )}
      {action && (
        <ManagementDialog
          title={
            action.kind === "reveal"
              ? "验证后查看邀请码"
              : `管理 ${action.row.name}`
          }
          close={close}
          pending={busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void apply();
            }}
          >
            <p>
              {action.kind === "delete"
                ? "删除后不能再兑换，已有兑换记录会保留。"
                : action.kind === "reset_expiry"
                  ? `从现在起重新计算 ${action.row.validity_days} 天有效期。`
                  : "请核对更改，保存后立即生效。"}
            </p>
            {action.kind === "reveal" ? (
              <label>
                当前账号密码
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            ) : ["quota", "extend"].includes(action.kind) ? (
              <label>
                {action.kind === "quota" ? "注册名额" : "延长天数"}
                <input
                  type="number"
                  min={
                    action.kind === "quota"
                      ? Math.max(1, action.row.used_count)
                      : 1
                  }
                  max={action.kind === "quota" ? 10000 : 365}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </label>
            ) : null}
            <ManagementError error={error} />
            <footer>
              <button type="button" className="btn" onClick={close}>
                取消
              </button>
              <button className="btn primary" disabled={busy}>
                确认
              </button>
            </footer>
          </form>
        </ManagementDialog>
      )}
      {secret && (
        <ManagementDialog title="邀请码已就绪" close={close}>
          <p>请复制并发送给需要注册的用户。</p>
          <div className="secret-once">
            <code>{secret}</code>
          </div>
          <ManagementError error={error} />
          <footer>
            <button
              className="btn"
              onClick={() =>
                void navigator.clipboard.writeText(secret).catch(setError)
              }
            >
              复制邀请码
            </button>
            <button className="btn primary" onClick={close}>
              完成
            </button>
          </footer>
        </ManagementDialog>
      )}
      {history && (
        <ManagementDialog
          title={`${history.name} · 兑换记录`}
          close={() => setHistory(null)}
        >
          <ManagementError error={redemptions.error} />
          {redemptions.isPending ? (
            <p>正在加载…</p>
          ) : (
            redemptions.data?.items.map((item) => (
              <div className="governance-record" key={item.id}>
                <strong>
                  {item.display_name} <small>@{item.username}</small>
                </strong>
                <span>{formatAccountDate(item.created_at)}</span>
              </div>
            ))
          )}
          {redemptions.data?.total === 0 && (
            <p className="empty-copy">暂无兑换记录。</p>
          )}
          <ManagementPagination
            total={redemptions.data?.total || 0}
            page={historyPage}
            setPage={setHistoryPage}
          />
        </ManagementDialog>
      )}
    </section>
  );
}
