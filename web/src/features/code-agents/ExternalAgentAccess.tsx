import { useId, useState } from "react";
import { Check, ChevronDown, Copy, Link2 } from "lucide-react";
import { useDesktopAgentAccess } from "@features/accounts";

const clients = [
  {
    id: "codex",
    label: "Codex · TOML",
    text: '[mcp_servers.future_props_lab]\ncommand = "fpl"\nargs = ["--profile", "codex", "mcp", "serve"]',
  },
  {
    id: "claude",
    label: "Claude Code · JSON",
    text: JSON.stringify(
      {
        mcpServers: {
          future_props_lab: {
            command: "fpl",
            args: ["--profile", "claude", "mcp", "serve"],
          },
        },
      },
      null,
      2,
    ),
  },
];

export function ExternalAgentAccess() {
  const { supported, enabled, busy, error, toggle } = useDesktopAgentAccess();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const id = useId();
  const status = !supported
    ? "需要桌面版"
    : error && enabled === null
      ? "状态读取失败"
      : enabled === null
        ? "正在读取状态…"
        : enabled
          ? "已开启"
          : "未开启";
  const copy = async (key: string, text: string) => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopyError("复制失败，请选择配置内容手动复制");
    }
  };
  return (
    <section
      className="code-agent-section code-agent-external"
      aria-labelledby={`${id}-title`}
    >
      <div className="code-agent-section-heading">
        <div>
          <h2 id={`${id}-title`}>
            <Link2 size={22} aria-hidden />
            外部客户端接入
          </h2>
          <p>让 Codex 或 Claude Code 连接已授权的 FPL 项目。</p>
        </div>
        <div className="code-agent-external-actions">
          <span
            className={`code-agent-status ${supported && enabled ? "is-ok" : "is-muted"}`}
          >
            <span aria-hidden />
            {status}
          </span>
          <button
            type="button"
            className="btn"
            aria-expanded={open}
            aria-controls={`${id}-config`}
            onClick={() => setOpen(!open)}
          >
            {open ? "收起配置" : "展开配置"}
            <ChevronDown
              size={16}
              aria-hidden
              className={open ? "is-expanded" : undefined}
            />
          </button>
        </div>
      </div>
      {error && (
        <p className="code-agent-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <div id={`${id}-config`} className="code-agent-external-body">
          {supported ? (
            <div className="code-agent-access-control">
              <p>
                仅向本机开放，每个客户端首次连接都需要你批准。关闭接入会断开客户端，但不会撤销已有密钥。
              </p>
              <button
                type="button"
                className={`btn${enabled ? "" : " primary"}`}
                disabled={busy || enabled === null}
                aria-pressed={enabled ?? false}
                onClick={() => void toggle()}
              >
                {busy
                  ? "正在设置…"
                  : enabled === null
                    ? "正在读取状态…"
                    : enabled
                      ? "关闭本地接入"
                      : "开启本地接入"}
              </button>
            </div>
          ) : (
            <p className="code-agent-empty">
              本地客户端接入需要使用 FPL 桌面版。浏览器中可查看和复制配置。
            </p>
          )}
          <ol>
            <li>
              开启本地接入后，在终端运行{" "}
              <code>fpl --profile codex connect --name Codex</code>；Claude Code
              使用独立 profile。
            </li>
            <li>
              在 FPL 核对配对码和空间，批准只读连接。编辑需要另行申请读写授权。
            </li>
            <li>
              将对应配置加入客户端，再调用 operations 核对操作和资源版本。
            </li>
          </ol>
          <div className="code-agent-client-grid">
            {clients.map((item) => (
              <div className="code-agent-snippet" key={item.id}>
                <div>
                  <h3>{item.label}</h3>
                  <button
                    type="button"
                    className="code-agent-copy"
                    aria-label={`复制 ${item.id} MCP 配置`}
                    onClick={() => void copy(item.id, item.text)}
                  >
                    {copied === item.id ? (
                      <Check size={16} aria-hidden />
                    ) : (
                      <Copy size={16} aria-hidden />
                    )}
                  </button>
                </div>
                <pre>{item.text}</pre>
              </div>
            ))}
          </div>
          {copied && (
            <p className="code-agent-notice" role="status">
              {copied === "codex" ? "Codex" : "Claude Code"} 配置已复制
            </p>
          )}
          {copyError && (
            <p className="code-agent-error" role="alert">
              {copyError}
            </p>
          )}
          <p className="code-agent-muted">
            客户端授权沿用账号设置中的 API 密钥列表，可随时撤销。使用随 App
            提供的 fpl；若终端未配置 PATH，请替换为实际可执行文件的绝对路径。
          </p>
        </div>
      )}
    </section>
  );
}
