import { useState } from "react";
import { Check, ChevronDown, Copy, Terminal } from "lucide-react";
import type { Agent } from "./api";

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

export function AgentConnectionCard({ agent }: { agent: Agent }) {
  const [details, setDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const status = states[agent.status] ?? { label: "状态未知", tone: "muted" };
  const command = agent.id === "codex" ? "codex login" : "claude auth login";
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
        <span className="code-agent-terminal">
          <Terminal size={24} aria-hidden />
        </span>
        <div className="code-agent-identity">
          <h2>{agent.name}</h2>
          <p>本机 CLI{agent.version && <> · v{agent.version}</>}</p>
        </div>
        <span className={`code-agent-status is-${status.tone}`}>
          <span aria-hidden />
          {status.label}
        </span>
      </div>
      <p className="code-agent-message">
        {agent.message || "连接由部署配置管理"}
      </p>
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
      <div className="code-agent-card-footer">
        <span>安装或登录后重新检测</span>
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
