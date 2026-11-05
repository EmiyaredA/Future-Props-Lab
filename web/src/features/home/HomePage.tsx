import { useState } from "react";
import {
  Braces,
  FileText,
  FlaskConical,
  Folder,
  Grid2X2,
  History,
  Link,
  Network,
  Plug,
} from "lucide-react";
import type { ApplicationDefinition } from "@features/applications";
import { TOOLS } from "@features/tools";
import { CompactPanelTabs } from "@shared/ui/CompactPanelTabs";
import { HomeInfrastructure } from "./HomeInfrastructure";
import { HomeHeroPet } from "./HomeHeroPet";
import { HomeApplicationFolders } from "./HomeApplicationFolders";
import { HomeFiles } from "./HomeFiles";
import { HomeResourceSection as ResourceSection } from "./HomeResourceSection";
import "./home.css";

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
          <HomeInfrastructure onNavigate={onNavigate} />
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
                  <span className="home-test-hint">参数在测试台配置</span>
                  <button
                    onClick={() => onNavigate(`/model-test?mode=${mode}`)}
                  >
                    开始测试
                  </button>
                </div>
              </div>
            </div>
          </div>
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
            </button>
          )}
        </section>
      </div>
      {showFiles ? (
        <HomeFiles onNavigate={onNavigate} canWrite={canWrite} />
      ) : (
        <ResourceSection
          id="home-files"
          title="文件管理"
          icon={Folder}
          action="进入文件库"
          onOpen={() => onNavigate("/files")}
        >
          <p className="home-resource-note">
            图片、视频、音频与文档，集中管理。
          </p>
        </ResourceSection>
      )}
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
            </button>
          ))}
        </div>
      </ResourceSection>
      <ResourceSection
        id="home-integrations"
        title="集成中心"
        description="连接工具与创作能力"
        icon={Link}
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
              description: "连接外部服务",
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
            </button>
          ))}
        </div>
      </ResourceSection>
    </section>
  );
}
