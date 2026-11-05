import { useRuntimeAccess } from "@features/accounts";
import "./sources.css";
import { useUnsavedNavigation } from "@shared/ui/useUnsavedNavigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cable,
  FolderOpen,
  Check,
  Plus,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { AgentLogo } from "@features/code-agents";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import {
  agents,
  bindSource,
  changeSource,
  displayTime,
  getCandidates,
  removeSource,
  scanSource,
  syncName,
  type AgentId,
  type Source,
} from "./api";
import { workbenchKeys } from "./queryKeys";

export function SourceManager({
  owner,
  sources,
  mutate,
}: {
  owner: string;
  sources: Source[];
  mutate: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const localBrowser = useRuntimeAccess();
  const [agent, setAgent] = useState<AgentId>("codex");
  const [root, setRoot] = useState("");
  const [label, setLabel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [kind, setKind] = useState("files");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Source | null>(null);
  const canWrite = useAccountPermission("content.write");
  const candidates = useQuery({
    queryKey: workbenchKeys.candidates(owner),
    queryFn: ({ signal }) => getCandidates(signal),
    retry: false,
    enabled: localBrowser,
  });
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      return await mutate(action);
    } finally {
      setBusy(false);
    }
  };
  const available = (candidates.data ?? []).filter((c) => c.agent_id === agent);
  const selected = sources.find(
    (s) => s.agent_id === agent && s.root === root && s.endpoint === endpoint,
  );
  const navigation = useUnsavedNavigation({
    dirty: !selected && Boolean(root || label || endpoint || consent),
    busy,
    title: "离开来源设置？",
    description: "来源尚未绑定，离开将放弃当前填写。",
  });
  return (
    <div className="aw-source-manager">
      {navigation.dialog}
      <div className="aw-section-heading">
        <Cable size={25} />
        <div>
          <h2>连接本机会话来源</h2>
          <p>读取已有 APP 与 CLI 记录，保存到当前账号的 FPL 阅读副本。</p>
        </div>
      </div>
      <div className="aw-agent-cards">
        {agents.map((item) => (
          <button
            key={item.id}
            className={agent === item.id ? "is-active" : ""}
            onClick={() =>
              navigation.action(() => {
                setAgent(item.id);
                setRoot("");
                setLabel("");
                setEndpoint("");
                setKind("files");
                setConsent(false);
              })
            }
          >
            <AgentLogo id={item.id} size={25} />
            <strong>{item.name}</strong>
            <span>
              {sources.some((s) => s.agent_id === item.id)
                ? "已绑定来源"
                : "选择来源"}
            </span>
          </button>
        ))}
      </div>
      {!localBrowser && (
        <p className="aw-note">
          请在 Mac 的本机网站入口绑定来源；已绑定会话可继续查看。
        </p>
      )}
      <fieldset
        className="aw-source-form"
        aria-label="绑定来源"
        disabled={!localBrowser}
      >
        <h3>选择 {agents.find((a) => a.id === agent)?.name} 来源</h3>
        {candidates.error && (
          <p className="aw-note">
            请在 Mac 的本机网站入口绑定新的会话来源。已绑定会话仍可继续查看。
          </p>
        )}
        <div className="aw-candidates">
          {available.map((item) => (
            <button
              key={item.root}
              className={root === item.root ? "is-active" : ""}
              disabled={!item.exists || busy}
              onClick={() =>
                navigation.action(() => {
                  setKind("files");
                  setRoot(item.root);
                  setEndpoint("");
                  setLabel(item.label);
                })
              }
            >
              <FolderOpen size={16} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.root}</small>
              </span>
              <span>
                {item.exists ? (
                  root === item.root ? (
                    <Check size={16} />
                  ) : (
                    "选择"
                  )
                ) : (
                  "未发现"
                )}
              </span>
            </button>
          ))}
        </div>
        {agent === "pi" && (
          <p className="aw-note">
            Pi 没有独立 APP
            时，可选择实际宿主使用的会话目录。未找到默认目录不代表没有历史。
          </p>
        )}
        {agent === "opencode" && (
          <CustomSelect
            ariaLabel="OpenCode 读取方式"
            value={kind}
            options={[
              { value: "files", label: "只读本机存储" },
              { value: "server", label: "连接已运行的本机实例" },
            ]}
            onChange={(next) =>
              navigation.action(() => {
                setKind(next);
                setRoot("");
                setEndpoint("");
                setConsent(false);
              })
            }
          />
        )}
        <label>
          来源名称
          <input
            value={label}
            maxLength={120}
            placeholder="例如：个人开发会话"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        {kind === "server" ? (
          <label>
            原实例地址
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="http://127.0.0.1:端口"
            />
            <small>
              连接 APP / TUI 已经使用的实例；不会另起 OpenCode 服务。
            </small>
          </label>
        ) : (
          <label>
            会话目录
            <div className="aw-path-input">
              <input
                value={root}
                onChange={(event) => setRoot(event.target.value)}
                placeholder="填写 Mac 会话目录的绝对路径"
              />
            </div>
            <small>仅扫描所选范围，不修改原生日志、数据库或配置。</small>
          </label>
        )}
        <label className="aw-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          允许当前账号读取这个来源，并保存本机阅读副本
        </label>
        <button
          className="aw-button is-primary"
          disabled={
            busy ||
            !canWrite ||
            !consent ||
            !label.trim() ||
            !(kind === "server" ? endpoint.trim() : root.trim()) ||
            !!selected
          }
          onClick={() =>
            void run(() =>
              bindSource({
                agent_id: agent,
                label,
                root: kind === "server" ? "" : root,
                endpoint: kind === "server" ? endpoint : "",
              }),
            )
          }
        >
          <Plus size={16} />
          {selected ? "此来源已绑定" : busy ? "正在绑定…" : "绑定并开始同步"}
        </button>
      </fieldset>
      <section className="aw-bound-sources">
        <h3>
          当前账号的来源 <span className="aw-badge">{sources.length}</span>
        </h3>
        {!sources.length && (
          <p className="aw-subtle">绑定后，将自动发现已有会话并持续同步。</p>
        )}
        {sources.map((source) => (
          <article key={source.id}>
            <div className="aw-source-heading">
              <AgentLogo id={source.agent_id} size={24} />
              <strong>{source.label}</strong>
              <span
                className={`aw-status ${source.enabled && source.status === "following" ? "is-live" : ""}`}
              >
                {!source.enabled
                  ? "已暂停"
                  : source.status === "unavailable"
                    ? "来源不可用"
                    : source.status === "partial"
                      ? "部分记录不可读"
                      : source.status === "pending"
                        ? "等待同步"
                        : syncName(source.sync_mode)}
              </span>
            </div>
            <p className="aw-source-path">{source.endpoint || source.root}</p>
            <p>{source.message}</p>
            <small>最后成功同步：{displayTime(source.last_synced_at)}</small>
            <div className="aw-source-actions">
              <button
                className="aw-button"
                disabled={busy || !canWrite}
                onClick={() =>
                  void run(() => changeSource(source, !source.enabled))
                }
              >
                {source.enabled ? "停用来源同步" : "启用来源同步"}
              </button>
              <button
                className="aw-button"
                disabled={busy || !canWrite || !source.enabled}
                onClick={() => void run(() => scanSource(source.id))}
              >
                <RefreshCw size={14} />
                重新扫描
              </button>
              <button
                className="aw-link"
                disabled={!canWrite || busy}
                onClick={() => setRemoving(source)}
              >
                <Unplug size={14} />
                解除绑定
              </button>
            </div>
          </article>
        ))}
      </section>
      <ConfirmDialog
        open={!!removing}
        title="解除来源绑定"
        description="停止采集这个来源，保留已经同步的 FPL 阅读副本。原 APP、CLI 和原生历史均不受影响。"
        confirmLabel="解除绑定"
        pending={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing && !(await run(() => removeSource(removing)))) return;
          setRemoving(null);
        }}
      />
    </div>
  );
}
