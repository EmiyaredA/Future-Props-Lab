import { AudioLines, Box, Image, MessageSquare, Server } from "lucide-react";
import { AgentLogo } from "@features/code-agents";

const modelKinds = [
  {
    icon: MessageSquare,
    title: "对话模型",
    tags: ["文本理解", "代码生成", "逻辑推理"],
  },
  {
    icon: Image,
    title: "视觉模型",
    tags: ["图像理解", "图像生成", "视频生成"],
  },
  {
    icon: AudioLines,
    title: "语音模型",
    tags: ["语音识别", "语音合成", "实时语音"],
  },
];
const agentKinds = [
  { id: "codex", name: "Codex" },
  { id: "claude-code", name: "Claude Code" },
  { id: "opencode", name: "OpenCode" },
  { id: "dsh", name: "DeepSeek Harness" },
  { id: "pi", name: "Pi CLI" },
] as const;

export function HomeInfrastructure({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="home-ai-feature home-panel home-infrastructure">
      <div className="home-feature-copy">
        <span className="home-copper-icon">
          <Box aria-hidden />
        </span>
        <h3>模型与智能体</h3>
        <p>
          接入模型服务
          <br />
          连接编程智能体
        </p>
      </div>
      <div className="home-infrastructure-preview">
        <section
          className="home-infrastructure-half"
          aria-labelledby="home-model-services"
        >
          <header>
            <Box aria-hidden />
            <h4 id="home-model-services">模型服务</h4>
          </header>
          <p>供应商与模型目录</p>
          <div
            className="home-model-preview"
            role="list"
            aria-label="模型能力概览"
          >
            {modelKinds.map(({ icon: Icon, title, tags }) => (
              <div className="home-model-row" role="listitem" key={title}>
                <span>
                  <Icon aria-hidden />
                  {title}
                </span>
                <span className="home-capability-tags">
                  {tags.map((tag) => (
                    <small key={tag}>{tag}</small>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <button
            className="home-text-link"
            onClick={() => onNavigate("/model-service")}
          >
            管理模型
          </button>
        </section>
        <section
          className="home-infrastructure-half"
          aria-labelledby="home-programming-agents"
        >
          <header>
            <Server aria-hidden />
            <h4 id="home-programming-agents">编程智能体</h4>
          </header>
          <p>支持的 CLI · 连接与执行配置</p>
          <div
            className="home-agent-preview"
            role="list"
            aria-label="支持的编程智能体"
          >
            {agentKinds.map((agent) => (
              <div className="home-agent-row" role="listitem" key={agent.id}>
                <AgentLogo id={agent.id} size={16} />
                {agent.name}
              </div>
            ))}
          </div>
          <button
            className="home-text-link"
            onClick={() => onNavigate("/code-agents")}
          >
            管理智能体
          </button>
        </section>
      </div>
    </div>
  );
}
