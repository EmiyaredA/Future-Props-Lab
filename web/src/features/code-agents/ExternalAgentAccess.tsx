import { useId, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";

const clients = {
  codex: {
    name: "Codex",
    profile: "codex",
    format: "TOML",
    text: '[mcp_servers.future_props_lab]\ncommand = "fpl"\nargs = ["--profile", "codex", "mcp", "serve"]',
  },
  "claude-code": {
    name: "Claude Code",
    profile: "claude",
    format: "JSON",
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
};

export function ExternalAgentAccess({
  agentId,
}: {
  agentId: keyof typeof clients;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const id = useId();
  const client = clients[agentId];
  const copy = async () => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(client.text);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("复制失败，请选择配置内容手动复制。");
    }
  };

  return (
    <>
      <p>
        如果你在 FPL 外运行 {client.name}，可通过 MCP 访问已授权的 FPL 项目。
      </p>
      <div className="code-agent-step-actions">
        <button
          type="button"
          className="btn code-agent-config-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? "收起 MCP 配置" : "展开 MCP 配置"}
          <ChevronDown
            size={14}
            aria-hidden
            className={open ? "is-expanded" : undefined}
          />
        </button>
      </div>
      <div id={id} hidden={!open} className="code-agent-external-body">
        <ol>
          <li>在网站账号设置中创建 Management API Key。</li>
          <li>
            将下方命令中的「FPL
            网站地址」替换为实际地址，在终端运行并按提示输入密钥。
            <code className="code-agent-connect-command">
              {`fpl --profile ${client.profile} connect --url "<FPL 网站地址>"`}
            </code>
          </li>
          <li>
            将下方配置加入 {client.name}，再调用 MCP 的 <code>operations</code>{" "}
            核对可用操作和资源版本。
          </li>
        </ol>
        <div className="code-agent-snippet">
          <div>
            <h5>
              {client.name} · {client.format}
            </h5>
            <button
              type="button"
              className="code-agent-copy code-agent-copy-command"
              aria-label={`复制 ${client.name} MCP 配置`}
              onClick={() => void copy()}
            >
              {copied ? (
                <Check size={16} aria-hidden />
              ) : (
                <Copy size={16} aria-hidden />
              )}
              <span>复制配置</span>
            </button>
          </div>
          <pre tabIndex={0} aria-label={`${client.name} MCP 配置示例`}>
            <code>{client.text}</code>
          </pre>
        </div>
        {copied && (
          <p className="code-agent-notice" role="status">
            {client.name} 配置已复制
          </p>
        )}
        {copyError && (
          <p className="code-agent-error" role="alert">
            {copyError}
          </p>
        )}
        <p>
          读写能力由密钥和账号权限共同决定，可在账号设置撤销密钥。如果终端找不到
          <code> fpl</code>，请在命令和配置中使用其绝对路径。
        </p>
      </div>
    </>
  );
}
