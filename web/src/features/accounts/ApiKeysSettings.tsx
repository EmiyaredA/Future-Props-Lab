import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Info,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ApiKeyMoreMenu } from "./ApiKeyMoreMenu";
import { deleteApiKey, renewApiKey, revokeApiKey, type ApiKey } from "./api";
import { formatAccountDate } from "./formatAccountDate";
import { accountAllows } from "./permissions";
import type { useAccountPanel } from "./useAccountPanel";
import "./api-keys-settings.css";
import "./api-keys-responsive.css";

const DAY_MS = 86_400_000;
const DURATION_OPTIONS = [30, 90, 180, 365].map((days) => ({
  value: String(days),
  label: `${days} 天`,
}));
const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "有效" },
  { value: "expiring", label: "即将到期" },
  { value: "expired", label: "已过期" },
  { value: "revoked", label: "已撤销" },
];

type KeyStatus = "active" | "expiring" | "expired" | "revoked";

function statusOf(key: ApiKey, now: number): KeyStatus {
  if (key.revoked_at) return "revoked";
  const expiresAt = Date.parse(key.expires_at);
  if (expiresAt <= now) return "expired";
  if (expiresAt - now <= 7 * DAY_MS) return "expiring";
  return "active";
}

const STATUS_LABELS: Record<KeyStatus, string> = {
  active: "有效",
  expiring: "即将到期",
  expired: "已过期",
  revoked: "已撤销",
};

function expectedRenewal(key: ApiKey, days: number, now: number) {
  const base = Math.max(Date.parse(key.expires_at), now);
  return formatAccountDate(new Date(base + days * DAY_MS).toISOString());
}

export function ApiKeysSettings({
  state,
}: {
  state: ReturnType<typeof useAccountPanel>;
}) {
  const {
    busy,
    createKey,
    keyDuration,
    keyName,
    keyWrite,
    keys,
    loadSecurity,
    me,
    copyRevealedKey,
    report,
    revealedKey,
    revealedKeyCopied,
    setKeyDuration,
    setKeyName,
    setKeyWrite,
  } = state;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [renewDuration, setRenewDuration] = useState("90");
  const [renewTarget, setRenewTarget] = useState<ApiKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const canWrite = accountAllows(me, "content.write");
  const [now] = useState(() => Date.now());
  const filteredKeys = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return keys.filter((key) => {
      const keyStatus = statusOf(key, now);
      const matchesStatus = status === "all" || keyStatus === status;
      const matchesQuery =
        !normalized ||
        key.name.toLocaleLowerCase().includes(normalized) ||
        key.key_prefix.toLocaleLowerCase().includes(normalized);
      return matchesStatus && matchesQuery;
    });
  }, [keys, now, query, status]);

  useEffect(() => {
    const current = (target: ApiKey | null) =>
      target ? keys.find((key) => key.id === target.id) || null : null;
    setRenewTarget((target) => current(target));
    setDeleteTarget((target) => current(target));
    setRevokeTarget((target) => current(target));
  }, [keys]);

  useEffect(() => {
    if (!canWrite && keyWrite) setKeyWrite(false);
  }, [canWrite, keyWrite, setKeyWrite]);

  const renew = async () => {
    if (!renewTarget) return;
    await report(async () => {
      await renewApiKey(renewTarget, Number(renewDuration));
      await loadSecurity();
      setRenewTarget(null);
    });
  };
  const remove = async () => {
    if (!deleteTarget) return;
    await report(async () => {
      await deleteApiKey(deleteTarget);
      await loadSecurity();
      setDeleteTarget(null);
    });
  };
  const revoke = async () => {
    if (!revokeTarget) return;
    await report(async () => {
      await revokeApiKey(revokeTarget);
      await loadSecurity();
      setRevokeTarget(null);
    });
  };

  return (
    <section className="api-keys-settings">
      <header className="api-keys-heading">
        <span className="api-keys-heading-icon">
          <KeyRound aria-hidden />
        </span>
        <div>
          <h3>管理 API 密钥</h3>
          <p>创建、续期或删除用于当前账号访问的管理密钥。</p>
        </div>
      </header>

      {revealedKey ? (
        <div className="api-key-secret" role="status">
          <span className="api-key-secret-icon">
            <ShieldCheck aria-hidden />
          </span>
          <div>
            <strong>请立即保存，这段密钥只显示一次</strong>
            <code>{revealedKey}</code>
          </div>
          <button
            type="button"
            className="btn small"
            onClick={() => void copyRevealedKey()}
          >
            {revealedKeyCopied ? "已复制" : "复制密钥"}
          </button>
        </div>
      ) : null}

      <form
        className="api-key-create-card"
        onSubmit={(event) => void createKey(event)}
      >
        <div className="api-key-card-title">
          <div>
            <h4>创建新密钥</h4>
            <p>密钥将绑定当前账号，创建后无法再次查看明文。</p>
          </div>
          <Info aria-hidden />
        </div>
        <div className="api-key-create-grid">
          <label className="api-key-name-field">
            <span>密钥名称</span>
            <input
              aria-label="密钥名称"
              maxLength={64}
              placeholder="例如：自动化部署"
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
            />
          </label>
          <div className="api-key-permissions" aria-label="权限">
            <span>权限</span>
            <div>
              <span className="api-key-permission is-selected">
                <Check aria-hidden />
                读取
              </span>
              <button
                type="button"
                role="checkbox"
                aria-label="允许写入当前账号"
                aria-checked={canWrite && keyWrite}
                className={`api-key-permission${canWrite && keyWrite ? " is-selected" : ""}`}
                disabled={!canWrite}
                onClick={() => setKeyWrite(!keyWrite)}
              >
                <Check aria-hidden />
                写入当前账号
              </button>
            </div>
          </div>
          <div className="api-key-duration-field">
            <span>有效期</span>
            <CustomSelect
              ariaLabel="密钥有效期"
              value={keyDuration}
              options={DURATION_OPTIONS}
              onChange={setKeyDuration}
            />
          </div>
          <button
            className="btn primary api-key-create-button"
            disabled={busy || !keyName.trim()}
          >
            {busy ? "正在创建…" : "创建密钥"}
          </button>
        </div>
      </form>

      <div className="api-key-list-heading">
        <div>
          <h4>密钥列表</h4>
          <span>共 {keys.length} 个密钥</span>
        </div>
        <div className="api-key-list-tools">
          <label className="api-key-search">
            <Search aria-hidden />
            <input
              aria-label="搜索密钥"
              placeholder="搜索名称或密钥前缀"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <CustomSelect
            ariaLabel="密钥状态"
            className="api-key-status-select"
            value={status}
            options={STATUS_OPTIONS}
            onChange={setStatus}
          />
        </div>
      </div>

      <div className="api-key-table-wrap">
        <table className="api-key-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>密钥</th>
              <th>权限范围</th>
              <th>创建时间</th>
              <th>到期时间</th>
              <th>状态</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {filteredKeys.map((key) => {
              const keyStatus = statusOf(key, now);
              return (
                <tr key={key.id}>
                  <td data-label="名称">
                    <strong title={key.name}>{key.name}</strong>
                  </td>
                  <td data-label="密钥">
                    <code>{key.key_prefix}••••</code>
                  </td>
                  <td data-label="权限范围">
                    <div className="api-key-scope-list">
                      {key.scopes.map((scope) => (
                        <span key={scope}>{scope}</span>
                      ))}
                    </div>
                  </td>
                  <td data-label="创建时间">
                    {formatAccountDate(key.created_at)}
                  </td>
                  <td data-label="到期时间">
                    {formatAccountDate(key.expires_at)}
                  </td>
                  <td data-label="状态">
                    <span className={`api-key-status ${keyStatus}`}>
                      {STATUS_LABELS[keyStatus]}
                    </span>
                  </td>
                  <td data-label="操作">
                    <div className="api-key-actions">
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy || keyStatus === "revoked"}
                        onClick={() => {
                          setRenewDuration("90");
                          setRenewTarget(key);
                        }}
                      >
                        <RefreshCw aria-hidden />
                        续期
                      </button>
                      <button
                        type="button"
                        className="btn small danger-quiet"
                        disabled={busy}
                        onClick={() => setDeleteTarget(key)}
                      >
                        <Trash2 aria-hidden />
                        删除
                      </button>
                      {keyStatus !== "revoked" ? (
                        <ApiKeyMoreMenu
                          name={key.name}
                          disabled={busy}
                          onRevoke={() => setRevokeTarget(key)}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filteredKeys.length ? (
          <div className="api-key-empty">
            <KeyRound aria-hidden />
            <strong>
              {keys.length ? "没有匹配的密钥" : "还没有 API 密钥"}
            </strong>
            <span>
              {keys.length
                ? "调整搜索或状态筛选后重试。"
                : "在上方创建第一个账号密钥。"}
            </span>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!renewTarget}
        title={`续期“${renewTarget?.name || ""}”`}
        tone="primary"
        confirmLabel="确认续期"
        pending={busy}
        onCancel={() => setRenewTarget(null)}
        onConfirm={renew}
        description={
          renewTarget ? (
            <div className="api-key-renew-copy">
              <p>
                当前到期时间：
                <strong>{formatAccountDate(renewTarget.expires_at)}</strong>
              </p>
              <div className="api-key-renew-duration">
                <span>延长时间</span>
                <CustomSelect
                  ariaLabel="续期时长"
                  value={renewDuration}
                  options={DURATION_OPTIONS}
                  onChange={setRenewDuration}
                />
              </div>
              <p>
                预计到期时间：
                <strong>
                  {expectedRenewal(renewTarget, Number(renewDuration), now)}
                </strong>
              </p>
              <small>续期后仍使用原密钥，无需修改调用方配置。</small>
            </div>
          ) : null
        }
      />
      <ConfirmDialog
        open={!!revokeTarget}
        title={`撤销“${revokeTarget?.name || ""}”`}
        confirmLabel="确认撤销"
        pending={busy}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={revoke}
        description="撤销后密钥立即失效，但记录仍会保留在列表中。"
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title={`删除“${deleteTarget?.name || ""}”`}
        confirmLabel="确认删除"
        pending={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={remove}
        description="删除后密钥立即失效并从列表移除，且无法恢复；安全记录仍会保留本次操作。"
      />
    </section>
  );
}
