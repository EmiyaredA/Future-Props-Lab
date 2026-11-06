import { useState, type ReactNode } from "react";
import { Check, ChevronDown, CircleCheck, Copy } from "lucide-react";
import type { Agent } from "./api";
import { AgentLogo } from "./AgentLogo";
import { ExternalAgentAccess } from "./ExternalAgentAccess";

const states: Record<string, { label: string; tone: string }> = {
  ready: { label: "已连接", tone: "ok" },
  ready_to_enable: { label: "待启用", tone: "muted" },
  disabled: { label: "未启用", tone: "muted" },
  not_installed: { label: "未安装", tone: "warning" },
  not_authenticated: { label: "未登录", tone: "warning" },
  unsupported_version: { label: "版本不支持", tone: "warning" },
  probe_failed: { label: "检测失败", tone: "danger" },
  not_authorized: { label: "未授权", tone: "warning" },
  unsupported_platform: { label: "平台不支持", tone: "muted" },
  runtime_unavailable: { label: "执行器不可用", tone: "danger" },
};

const guides = {
  codex: {
    binary: "codex",
    installUrl: "https://learn.chatgpt.com/docs/codex/cli",
    title: "为 FPL 单独登录 Codex",
    command: 'npm --prefix "<FPL 安装目录>" run codex:login',
    instruction:
      "将 <FPL 安装目录> 替换为绝对路径，然后在任意目录运行，按终端提示完成专用登录。",
  },
  "claude-code": {
    binary: "claude",
    installUrl: "https://code.claude.com/docs/en/quickstart",
    title: "登录 Claude Code",
    command: "claude auth login",
    instruction: "按终端提示在浏览器授权，等待终端确认登录完成。",
  },
  opencode: {
    binary: "opencode",
    installUrl: "https://opencode.ai/docs/#install",
    title: "登录模型供应商",
    command: "opencode auth login",
    instruction: "按终端提示选择供应商并完成认证，确认凭据已保存。",
  },
  dsh: {
    binary: "dsh",
    installUrl: "https://github.com/deepseek-ai/deepseek-harness#run",
    title: "登录 DeepSeek Harness",
    command: "dsh web",
    instruction:
      "先确认终端能找到 dsh，再运行命令，在打开的 Harness 页面完成登录。",
  },
  pi: {
    binary: "pi",
    installUrl: "https://pi.dev/",
    title: "登录模型供应商",
    command: "pi",
    instruction: "启动 Pi 后，在交互界面输入 /login，选择供应商并完成认证。",
  },
} satisfies Record<
  Agent["id"],
  {
    binary: string;
    installUrl: string;
    title: string;
    command: string;
    instruction: string;
  }
>;

function GuideStep({
  number,
  title,
  current = false,
  children,
}: {
  number: number;
  title: string;
  current?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="code-agent-step" aria-current={current ? "step" : undefined}>
      <span className="code-agent-step-number" aria-hidden>
        {number}
      </span>
      <div className="code-agent-step-body">
        <h4>{title}</h4>
        {children}
      </div>
    </li>
  );
}

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
  detection,
  onEnable,
  checking = false,
}: {
  agent: Agent;
  detection?: ReactNode;
  onEnable?: () => void;
  checking?: boolean;
}) {
  const [details, setDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const guide = guides[agent.id];
  const ready = agent.status === "ready";
  const readyToEnable = agent.status === "ready_to_enable";
  const needsLogin = agent.status === "not_authenticated";
  const needsInstall =
    agent.status === "not_installed" || agent.status === "unsupported_version";
  const canManageConnection = !agent.enabled && onEnable;
  const copy = async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(guide.command);
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
      <div className="code-agent-diagnostics">
        <p className="code-agent-message">
          {agent.message || "连接由部署配置管理"}
        </p>
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
      <section
        className="code-agent-guide"
        aria-label={`${agent.name} 接入教程`}
      >
        <div className="code-agent-guide-heading">
          <h3>连接 {agent.name}</h3>
          <span>在运行 FPL 的 Mac 上操作</span>
        </div>
        <ol className="code-agent-steps" role="list">
          <GuideStep number={1} title="确认 CLI 已安装" current={needsInstall}>
            {agent.version ? (
              <p className="code-agent-step-confirmation">
                <CircleCheck size={16} aria-hidden />
                已检测到 {agent.name}
                {` · v${agent.version}`}
              </p>
            ) : agent.status === "disabled" ? (
              <p>安装状态待本机管理员检测。</p>
            ) : null}
            {!agent.version && (
              <p>
                <a href={guide.installUrl} target="_blank" rel="noreferrer">
                  官方安装指南
                </a>
                ，安装后在终端运行 <code>{guide.binary} --version</code>{" "}
                检查版本。
              </p>
            )}
          </GuideStep>
          <GuideStep number={2} title={guide.title} current={needsLogin}>
            {(ready || readyToEnable) && (
              <p className="code-agent-step-confirmation">
                <CircleCheck size={16} aria-hidden />
                {agent.id === "dsh" ? "已检测到本机凭据" : "登录已验证"}
              </p>
            )}
            {needsLogin && <p>尚未通过登录检查。</p>}
            <p>{guide.instruction}</p>
            <div className="code-agent-commands">
              <code>{guide.command}</code>
              <button
                type="button"
                className="code-agent-copy code-agent-copy-command"
                aria-label={`复制 ${agent.name} 登录命令`}
                onClick={() => void copy()}
              >
                {copied ? (
                  <Check size={16} aria-hidden />
                ) : (
                  <Copy size={16} aria-hidden />
                )}
                <span>复制命令</span>
              </button>
            </div>
            {copied && <p role="status">登录命令已复制</p>}
            {error && (
              <p className="code-agent-error" role="alert">
                {error}
              </p>
            )}
          </GuideStep>
          <GuideStep
            number={3}
            title="返回 FPL 验证连接"
            current={readyToEnable}
          >
            {!agent.enabled ? (
              <p>
                {canManageConnection
                  ? readyToEnable
                    ? "点击启用连接，并验证 FPL 管理员密码。"
                    : "完成安装和登录后，点击「重新检测」。两项通过后即可启用。"
                  : "安装并登录后，请联系运行 FPL 的 Mac 上的管理员启用连接。"}
              </p>
            ) : (
              <p>
                {ready
                  ? `现在可在有权限的功能中选择 ${agent.name}。`
                  : "完成上方步骤后重新检测，核对状态是否显示「已连接」。"}
              </p>
            )}
            <div className="code-agent-step-actions">
              {canManageConnection && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={checking || !readyToEnable}
                  onClick={onEnable}
                >
                  启用 CLI 连接
                </button>
              )}
              {detection}
            </div>
          </GuideStep>
          {(agent.id === "codex" || agent.id === "claude-code") && (
            <GuideStep number={4} title="让外部客户端访问 FPL（可选）">
              <ExternalAgentAccess agentId={agent.id} />
            </GuideStep>
          )}
        </ol>
      </section>
    </article>
  );
}
