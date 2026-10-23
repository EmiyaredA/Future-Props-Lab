import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { QueryFeedback } from "@shared/ui/QueryFeedback";
import { apiErrorMessage } from "@platform/api/errors";
import { codeAgentKeys, detectAgents, getAgents } from "./api";
import { AgentConnectionCard } from "./AgentConnectionCard";
import { AgentGrants } from "./AgentGrants";
import { ExternalAgentAccess } from "./ExternalAgentAccess";
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
  const actions = (
    <button
      type="button"
      className="btn"
      disabled={detect.isPending || agents.isFetching}
      onClick={() => detect.mutate()}
    >
      <RefreshCw
        size={16}
        aria-hidden
        className={detect.isPending ? "code-agent-spinning" : undefined}
      />
      {detect.isPending ? "检测中…" : "重新检测"}
    </button>
  );
  return (
    <section
      className={`code-agents-page${renderHeader ? " model-infrastructure-page" : ""}`}
    >
      {renderHeader ? (
        renderHeader(actions)
      ) : (
        <header className="code-agents-heading">
          <div>
            <h1>编程智能体</h1>
            <p>连接 Codex 或 Claude Code，供 Amadeus 与工坊使用。</p>
          </div>
          {actions}
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
        {agents.data && (
          <>
            {agents.data.items.length ? (
              <div className="code-agents-grid">
                {agents.data.items.map((agent) => (
                  <AgentConnectionCard key={agent.id} agent={agent} />
                ))}
              </div>
            ) : (
              <p className="code-agent-empty">
                暂无编程智能体连接，请检查部署配置后重新检测。
              </p>
            )}
            {canManage && (
              <AgentGrants scope={scope} agents={agents.data.items} />
            )}
          </>
        )}
        <ExternalAgentAccess />
      </div>
    </section>
  );
}
