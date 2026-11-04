import { LoadingScene } from "@shared/ui/LoadingScene";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { QueryFeedback } from "@shared/ui/QueryFeedback";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { apiErrorMessage } from "@platform/api/errors";
import { reauthenticate } from "@features/accounts";
import {
  codeAgentKeys,
  detectAgents,
  enableAgent,
  getAgents,
  type Agent,
} from "./api";
import { AgentConnectionCard, AgentStatus } from "./AgentConnectionCard";
import { ExternalAgentAccess } from "./ExternalAgentAccess";
import { AgentLogo } from "./AgentLogo";
import "./code-agents.css";

export function CodeAgentsPage({
  canManage,
  scope,
  renderHeader,
}: {
  canManage: boolean;
  scope: string;
  renderHeader?: (actions: ReactNode) => ReactNode;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [enabling, setEnabling] = useState<Agent>();
  const [enableError, setEnableError] = useState("");
  const [enablePending, setEnablePending] = useState(false);
  const client = useQueryClient();
  const agents = useQuery({
    queryKey: codeAgentKeys.catalog(scope),
    queryFn: getAgents,
  });
  const detect = useMutation({
    mutationFn: detectAgents,
    retry: false,
    onSuccess: (data) =>
      client.setQueryData(codeAgentKeys.catalog(scope), data),
  });
  const selectedAgent =
    agents.data?.items.find((agent) => agent.id === selectedAgentId) ??
    agents.data?.items[0];

  async function confirmEnable(password: string) {
    if (!enabling) return;
    setEnablePending(true);
    setEnableError("");
    try {
      await reauthenticate(password);
      await enableAgent(enabling.id);
      await client.invalidateQueries({ queryKey: codeAgentKeys.root });
      setEnabling(undefined);
    } catch (error) {
      setEnableError(apiErrorMessage(error, "无法启用 CLI 连接"));
    } finally {
      setEnablePending(false);
    }
  }
  const actions = (
    <button
      type="button"
      className="code-agent-detect"
      disabled={detect.isPending || agents.isFetching}
      onClick={() => detect.mutate()}
    >
      <>
        {detect.isPending ? (
          <LoadingScene />
        ) : (
          <RefreshCw size={14} aria-hidden />
        )}
      </>
      {detect.isPending ? "检测中…" : "重新检测"}
    </button>
  );
  return (
    <section
      className={`code-agents-page${renderHeader ? " model-infrastructure-page" : ""}`}
    >
      {renderHeader ? (
        renderHeader(selectedAgent ? null : actions)
      ) : (
        <header className="code-agents-heading">
          <div>
            <h1>编程智能体</h1>
            <p>管理本机编程智能体，供 Amadeus 与工坊使用。</p>
          </div>
          {!selectedAgent && actions}
        </header>
      )}
      <div
        id={renderHeader ? "model-infrastructure-content" : undefined}
        role={renderHeader ? "tabpanel" : undefined}
        aria-labelledby={
          renderHeader ? "infrastructure-tab-code-agents" : undefined
        }
      >
        <QueryFeedback
          error={agents.error}
          pending={agents.isPending}
          onRetry={() => agents.refetch()}
        />
        {detect.error && (
          <p className="code-agent-error" role="alert">
            {apiErrorMessage(detect.error, "检测失败，请稍后重试")}
          </p>
        )}
        {detect.isSuccess && (
          <p className="code-agent-notice" role="status">
            连接状态已更新
          </p>
        )}
        <div
          className={`code-agent-console${selectedAgent ? "" : " is-empty"}`}
        >
          {agents.data && (
            <>
              {agents.data.items.length ? (
                <>
                  <div
                    className="code-agent-roster"
                    role="group"
                    aria-label="本机编程智能体"
                  >
                    {agents.data.items.map((agent) => {
                      const selected = agent.id === selectedAgent?.id;
                      return (
                        <button
                          type="button"
                          key={agent.id}
                          className="code-agent-roster-item"
                          aria-pressed={selected}
                          onClick={() => setSelectedAgentId(agent.id)}
                        >
                          <span className="code-agent-roster-icon">
                            <AgentLogo id={agent.id} size={20} />
                          </span>
                          <span className="code-agent-roster-copy">
                            <strong>{agent.name}</strong>
                            <AgentStatus agent={agent} />
                          </span>
                        </button>
                      );
                    })}
                    <div className="code-agent-roster-footer">{actions}</div>
                  </div>
                  <div className="code-agent-settings">
                    {selectedAgent && (
                      <AgentConnectionCard
                        key={selectedAgent.id}
                        agent={selectedAgent}
                        onEnable={
                          canManage && agents.data.can_enable
                            ? () => {
                                setEnableError("");
                                setEnabling(selectedAgent);
                              }
                            : undefined
                        }
                      />
                    )}
                  </div>
                </>
              ) : (
                <p className="code-agent-empty">
                  暂无编程智能体连接，请检查部署配置后重新检测。
                </p>
              )}
            </>
          )}
          <ExternalAgentAccess />
        </div>
      </div>
      {enabling && (
        <TextInputDialog
          open
          title={`启用 ${enabling.name} 连接`}
          label="FPL 管理员密码"
          inputType="password"
          confirmLabel="启用连接"
          pending={enablePending}
          error={enableError}
          onCancel={() => setEnabling(undefined)}
          onConfirm={(password) => void confirmEnable(password)}
        />
      )}
    </section>
  );
}
