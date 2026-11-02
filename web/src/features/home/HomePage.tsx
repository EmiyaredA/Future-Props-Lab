import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Box,
  Braces,
  ChevronDown,
  FileText,
  FlaskConical,
  Folder,
  Grid2X2,
  History,
  Image,
  Link,
  MessageSquare,
  Network,
  Plug,
  Server,
  Wrench,
} from "lucide-react";
import type { ApplicationDefinition } from "@features/applications";
import { TOOLS } from "@features/tools";
import { CompactPanelTabs } from "@shared/ui/CompactPanelTabs";
import { HomeHeroPet } from "./HomeHeroPet";
import { HomeApplicationFolders } from "./HomeApplicationFolders";
import { HomeFiles } from "./HomeFiles";
import "./home.css";

function ResourceSection({
  id,
  title,
  description,
  icon: Icon,
  action,
  onOpen,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: typeof Folder;
  action: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className="home-resource home-panel" tabIndex={-1}>
      <header className="home-section-heading">
        <span className="home-copper-icon">
          <Icon aria-hidden />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button className="home-text-link" onClick={onOpen}>
          {action}
          <ArrowUpRight aria-hidden />
        </button>
        <button
          className="home-collapse"
          aria-expanded={open}
          aria-controls={`${id}-content`}
          onClick={() => setOpen(!open)}
        >
          {open ? "收起" : "展开"}
          <ChevronDown aria-hidden data-open={open} />
        </button>
      </header>
      <div id={`${id}-content`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export function HomePage({
  onNavigate,
  applications = [],
  canWrite = false,
  canManageHost = false,
  canReadLogs = true,
  showFiles = false,
}: {
  onNavigate: (path: string) => void;
  applications?: readonly ApplicationDefinition[];
  canWrite?: boolean;
  canManageHost?: boolean;
  canReadLogs?: boolean;
  showFiles?: boolean;
}) {
  const [mode, setMode] = useState("chat");
  const modes = [
    { value: "chat", label: "对话" },
    { value: "image", label: "图像" },
    { value: "video", label: "视频" },
    { value: "synthesis", label: "语音" },
  ];
  const modeCopy: Record<string, string> = {
    chat: "选择模型，开始一段对话",
    image: "描述画面，探索图像生成",
    video: "从文字或图片开始生成视频",
    synthesis: "输入文本，试听语音合成",
  };
  const jumpTo = (id: string) => {
    const section = document.getElementById(id);
    section?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
    section?.focus({ preventScroll: true });
  };
  return (
    <section className="page home-page">
      <header className="home-header">
        <div className="home-header-copy">
          <span className="home-eyebrow">你的灵感，随时开场</span>
          <h1>今天想从哪里开始？</h1>
          <p>从一个好想法，到下一件作品。</p>
        </div>
        <HomeHeroPet />
      </header>
      <div className="home-primary">
        <section
          className="home-applications home-panel"
          aria-labelledby="home-app-title"
        >
          <header className="home-section-heading">
            <h2 id="home-app-title">AI 应用</h2>
            <span className="home-count">{applications.length} 个应用</span>
            <button
              className="home-text-link"
              onClick={() => onNavigate("/apps")}
            >
              全部应用
              <ArrowUpRight aria-hidden />
            </button>
          </header>
          <HomeApplicationFolders
            applications={applications}
            onNavigate={onNavigate}
          />
        </section>
        <section className="home-ai" aria-labelledby="home-ai-title">
          <header className="home-section-heading">
            <h2 id="home-ai-title">AI 能力</h2>
            <p>从模型接入，到效果验证。</p>
          </header>
          <div className="home-ai-feature home-panel">
            <div className="home-feature-copy">
              <span className="home-copper-icon">
                <Box aria-hidden />
              </span>
              <h3>模型与智能体</h3>
              <p>
                供应商、模型目录与
                <br />
                编程智能体
              </p>
              <button
                className="home-text-link"
                onClick={() => onNavigate("/model-service")}
              >
                管理模型
                <ArrowUpRight aria-hidden />
              </button>
            </div>
            <div className="home-model-preview" aria-label="模型能力入口">
              {[
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
              ].map(({ icon: Icon, title, tags }) => (
                <button
                  key={title}
                  onClick={() => onNavigate("/model-service")}
                >
                  <span>
                    <Icon aria-hidden />
                    {title}
                  </span>
                  <span className="home-capability-tags">
                    {tags.map((tag) => (
                      <small key={tag}>{tag}</small>
                    ))}
                  </span>
                  <ArrowUpRight aria-hidden />
                </button>
              ))}
              <button
                className="home-agent-link"
                onClick={() => onNavigate("/code-agents")}
              >
                <Server aria-hidden />
                编程智能体<span>连接与执行配置</span>
                <ArrowRight aria-hidden />
              </button>
            </div>
          </div>
          <div className="home-ai-feature home-test-feature home-panel">
            <div className="home-feature-copy">
              <span className="home-copper-icon">
                <FlaskConical aria-hidden />
              </span>
              <h3>模型测试</h3>
              <p>
                对话、图像、视频
                <br />
                与语音测试
              </p>
              <button
                className="home-text-link"
                onClick={() => onNavigate(`/model-test?mode=${mode}`)}
              >
                开始测试
                <ArrowUpRight aria-hidden />
              </button>
            </div>
            <div className="home-test-preview">
              <CompactPanelTabs
                label="首页测试模式"
                value={mode}
                onChange={setMode}
                options={modes}
              />
              <div className="home-test-draft">
                <span>{modeCopy[mode]}</span>
                <div>
                  <span className="home-test-hint">参数与工具在测试台配置</span>
                  <button
                    aria-label={`进入${modes.find((item) => item.value === mode)?.label}测试`}
                    onClick={() => onNavigate(`/model-test?mode=${mode}`)}
                  >
                    <ArrowUpRight aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="home-ai-secondary">
            <button
              className="home-panel home-mini-link"
              onClick={() => onNavigate("/model-test-tools")}
            >
              <span className="home-copper-icon">
                <Wrench aria-hidden />
              </span>
              <span>
                <strong>测试工具</strong>
                <small>配置模型可调用的工具</small>
              </span>
              <ArrowRight aria-hidden />
            </button>
            {canReadLogs && (
              <button
                className="home-panel home-mini-link"
                onClick={() => onNavigate("/model-call-logs")}
              >
                <span className="home-copper-icon">
                  <History aria-hidden />
                </span>
                <span>
                  <strong>调用日志</strong>
                  <small>用量、耗时与错误记录</small>
                </span>
                <ArrowRight aria-hidden />
              </button>
            )}
          </div>
        </section>
      </div>
      <nav className="home-jump home-panel" aria-label="首页资源导航">
        {[
          { id: "home-files", icon: Folder, label: "文件管理" },
          { id: "home-tools", icon: Grid2X2, label: "工具导航" },
          { id: "home-integrations", icon: Link, label: "集成中心" },
        ].map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => jumpTo(id)}>
            <Icon aria-hidden />
            {label}
            <ChevronDown aria-hidden />
          </button>
        ))}
      </nav>
      <ResourceSection
        id="home-files"
        title="文件管理"
        description="素材与文件，统一整理"
        icon={Folder}
        action="进入文件库"
        onOpen={() => onNavigate("/files")}
      >
        {showFiles ? (
          <HomeFiles onNavigate={onNavigate} canWrite={canWrite} />
        ) : (
          <p className="home-resource-note">
            图片、视频、音频与文档，集中管理。
          </p>
        )}
      </ResourceSection>
      <ResourceSection
        id="home-tools"
        title="工具导航"
        description="常用工具，随手可达"
        icon={Grid2X2}
        action="全部工具"
        onOpen={() => onNavigate("/tools")}
      >
        <div className="home-resource-grid">
          {TOOLS.filter(
            (tool) =>
              tool.target.kind === "internal" &&
              (canManageHost ||
                !["storage-usage", "codex-model-source"].includes(tool.id)),
          ).map((tool) => (
            <button
              key={tool.id}
              className="home-resource-link"
              onClick={() =>
                tool.target.kind === "internal" && onNavigate(tool.target.path)
              }
            >
              <span className="home-copper-icon">
                <tool.icon aria-hidden />
              </span>
              <span>
                <strong>{tool.name}</strong>
                <small>{tool.description}</small>
              </span>
              <ArrowRight aria-hidden />
            </button>
          ))}
        </div>
      </ResourceSection>
      <ResourceSection
        id="home-integrations"
        title="集成中心"
        description="连接工具与创作能力"
        icon={Link}
        action="管理集成"
        onOpen={() => onNavigate("/integrations/tool-apis")}
      >
        <div className="home-resource-grid">
          {[
            {
              name: "工具 API",
              description: "接入外部接口",
              icon: Braces,
              path: "tool-apis",
            },
            {
              name: "MCP",
              description: "连接工具服务",
              icon: Network,
              path: "mcp",
            },
            {
              name: "Skill",
              description: "管理可复用技能",
              icon: FileText,
              path: "skills",
            },
            {
              name: "外部连接",
              description: "配置 CLI 连接",
              icon: Plug,
              path: "external-connections",
            },
          ].map((item) => (
            <button
              key={item.path}
              className="home-resource-link"
              onClick={() => onNavigate(`/integrations/${item.path}`)}
            >
              <span className="home-copper-icon">
                <item.icon aria-hidden />
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>{item.description}</small>
              </span>
              <ArrowRight aria-hidden />
            </button>
          ))}
        </div>
      </ResourceSection>
    </section>
  );
}
