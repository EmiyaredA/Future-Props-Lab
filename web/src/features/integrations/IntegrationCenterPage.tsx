import { ValidationRecoveryPanel } from "./ValidationRecoveryPanel";
import { IntegrationInteractions } from "./IntegrationInteractions";
import type { NavigationGuard } from "./interaction";
import { useState } from "react";
import { McpPanel } from "@features/integrations/McpPanel";
import { SkillPanel } from "@features/integrations/SkillPanel";
import { ToolApiPanel } from "@features/integrations/ToolApiPanel";
import { ExternalConnectionsPanel } from "./external/ExternalConnectionsPanel";
import "@features/integrations/integrations-foundation.css";
import "@features/integrations/integrations-components.css";

export type IntegrationKind =
  "tool-apis" | "mcp" | "skills" | "external-connections";
const INTEGRATION_TABS = [
  ["tool-apis", "工具 API"],
  ["mcp", "MCP"],
  ["skills", "Skill"],
  ["external-connections", "外部连接"],
] as const;

export function IntegrationCenterPage({
  kind,
  onKindChange,
  canManage,
  registerNavigationGuard,
}: {
  kind: IntegrationKind;
  onKindChange: (kind: IntegrationKind) => void;
  canManage: boolean;
  registerNavigationGuard?: (guard: NavigationGuard | null) => void;
}) {
  const [toolSearch, setToolSearch] = useState("");
  const [toolStatus, setToolStatus] = useState("all");
  const [mcpSearch, setMcpSearch] = useState("");
  const [mcpTransport, setMcpTransport] = useState("all");
  const [skillSearch, setSkillSearch] = useState("");
  const [skillStatus, setSkillStatus] = useState("all");
  return (
    <IntegrationInteractions registerNavigationGuard={registerNavigationGuard}>
      <section className="page integrations-page">
        <header className="integrations-header">
          <h1>集成中心</h1>
          <p>统一管理工具 API、MCP 服务、Skill 与外部连接</p>
        </header>
        {canManage ? <ValidationRecoveryPanel /> : null}
        <div className="integration-tabs" role="tablist" aria-label="集成类型">
          {INTEGRATION_TABS.map(([value, label], index) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              aria-controls={`integration-panel-${value}`}
              className={kind === value ? "active" : ""}
              onClick={() => onKindChange(value)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % INTEGRATION_TABS.length;
                else if (event.key === "ArrowLeft")
                  next =
                    (index - 1 + INTEGRATION_TABS.length) %
                    INTEGRATION_TABS.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End")
                  next = INTEGRATION_TABS.length - 1;
                else return;
                event.preventDefault();
                const tab = INTEGRATION_TABS[next][0];
                onKindChange(tab);
                const buttons =
                  event.currentTarget.parentElement?.querySelectorAll("button");
                buttons?.[next]?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {!canManage ? (
          <div className="integration-readonly" role="status">
            当前为只读模式，账号所有者可以管理和验证集成。
          </div>
        ) : null}
        <div
          id="integration-panel-tool-apis"
          role="tabpanel"
          hidden={kind !== "tool-apis"}
        >
          {kind === "tool-apis" ? (
            <ToolApiPanel
              canManage={canManage}
              search={toolSearch}
              status={toolStatus}
              onSearchChange={setToolSearch}
              onStatusChange={setToolStatus}
            />
          ) : null}
        </div>
        <div id="integration-panel-mcp" role="tabpanel" hidden={kind !== "mcp"}>
          {kind === "mcp" ? (
            <McpPanel
              canManage={canManage}
              search={mcpSearch}
              transport={mcpTransport}
              onSearchChange={setMcpSearch}
              onTransportChange={setMcpTransport}
            />
          ) : null}
        </div>
        <div
          id="integration-panel-skills"
          role="tabpanel"
          hidden={kind !== "skills"}
        >
          {kind === "skills" ? (
            <SkillPanel
              canManage={canManage}
              search={skillSearch}
              status={skillStatus}
              onSearchChange={setSkillSearch}
              onStatusChange={setSkillStatus}
            />
          ) : null}
        </div>
        <div
          id="integration-panel-external-connections"
          role="tabpanel"
          hidden={kind !== "external-connections"}
        >
          {kind === "external-connections" && (
            <ExternalConnectionsPanel canManage={canManage} />
          )}
        </div>
      </section>
    </IntegrationInteractions>
  );
}
