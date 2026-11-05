import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import type { Agent } from "./api";
import { AgentLogo } from "./AgentLogo";

const states: Record<string, { label: string; tone: string }> = {
  ready: { label: "已连接", tone: "ok" },
  disabled: { label: "未启用", tone: "muted" },
  not_installed: { label: "未安装", tone: "warning" },
  not_authenticated: { label: "未登录", tone: "warning" },
  unsupported_version: { label: "版本不支持", tone: "warning" },
  probe_failed: { label: "检测失败", tone: "danger" },
  not_authorized: { label: "未授权", tone: "warning" },
  unsupported_platform: { label: "平台不支持", tone: "muted" },
};

export function AgentStatus({ agent }: { agent: Agent }) {
  const status = states[agent.status] ?? { label: "状态未知", tone: "muted" };
  return (
    <span className={`code-agent-status is-${status.tone}`}>
      <span aria-hidden />
      {status.label}
    </span>
  );
}

export function AgentConnectionCard({
  agent,
  onEnable,
}: {
  agent: Agent;
  onEnable?: () => void;
}) {
  const [details, setDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const command = {
    codex: "npm run codex:login",
    "claude-code": "claude auth login",
    opencode: "opencode auth login",
    dsh: "dsh web",
    pi: "pi",
  }[agent.id];
  const help =
    agent.id === "codex"
      ? "在服务所在 Mac 的 FPL 项目目录执行，完成专用登录后重新检测"
      : agent.id === "pi"
        ? "在 Pi 中使用 /login，完成后重新检测"
        : agent.id === "dsh"
          ? "在 Harness 中完成登录后重新检测"
          : "安装或登录后重新检测";
  const copy = async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("复制失败，请手动复制登录命令");
    }
  };
  return (
    <article className="code-agent-card" aria-label={`${agent.name} 连接`}>
      <div className="code-agent-card-heading">
        <AgentLogo id={agent.id} size={22} />
        <div className="code-agent-identity">
          <h2>{agent.name}</h2>
          <p>本机 CLI{agent.version && <> · v{agent.version}</>}</p>
        </div>
        <AgentStatus agent={agent} />
      </div>
      <p className="code-agent-message">
        {agent.message || "连接由部署配置管理"}
      </p>
      {onEnable && !agent.enabled && (
        <button
          className="btn primary code-agent-enable"
          type="button"
          onClick={onEnable}
        >
          启用 CLI 连接
        </button>
      )}
      <div className="code-agent-login-row">
        <span className="code-agent-field-label">登录命令</span>
        <div className="code-agent-commands">
          <code>{command}</code>
          <button
            type="button"
            className="code-agent-copy"
            aria-label={`复制 ${agent.name} 登录命令`}
            onClick={() => void copy()}
          >
            {copied ? (
              <Check size={16} aria-hidden />
            ) : (
              <Copy size={16} aria-hidden />
            )}
          </button>
        </div>
        <span className="code-agent-login-help">{help}</span>
        {agent.executable && (
          <button
            type="button"
            className="code-agent-disclosure"
            aria-expanded={details}
            aria-controls={`agent-details-${agent.id}`}
            onClick={() => setDetails(!details)}
          >
            连接详情
            <ChevronDown
              size={14}
              aria-hidden
              className={details ? "is-expanded" : undefined}
            />
          </button>
        )}
      </div>
      {copied && (
        <span className="code-agent-muted" role="status">
          登录命令已复制
        </span>
      )}
      {error && (
        <p className="code-agent-error" role="alert">
          {error}
        </p>
      )}
      {agent.executable && details && (
        <div id={`agent-details-${agent.id}`} className="code-agent-details">
          <span>可执行文件</span>
          <code>{agent.executable}</code>
          <p>CLI 路径和启用项由部署配置管理。</p>
        </div>
      )}
    </article>
  );
}
