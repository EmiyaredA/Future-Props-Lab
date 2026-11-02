import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck } from "lucide-react";
import { ApiError, apiErrorMessage } from "@platform/api/errors";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { QueryFeedback } from "@shared/ui/QueryFeedback";
import { AgentLogo } from "./AgentLogo";
import {
  codeAgentKeys,
  getGrants,
  putGrants,
  type Agent,
  type Grant,
  type Grants,
} from "./api";

const purposes = [
  { id: "amadeus", label: "Amadeus" },
  { id: "visual_acceptance", label: "视觉验收" },
  { id: "interview_preparation", label: "面试准备" },
] as const;

function effectiveGrants(state: Grants, key: string) {
  return state.managed.includes(key)
    ? state.grants
    : [...state.grants, ...state.legacy];
}

export function AgentGrants({
  scope,
  agents,
}: {
  scope: string;
  agents: Agent[];
}) {
  const client = useQueryClient();
  const grants = useQuery({
    queryKey: codeAgentKeys.grants(scope),
    queryFn: getGrants,
  });
  const [account, setAccount] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const accounts = grants.data?.accounts ?? [];
  const accountId = accounts.some((item) => item.id === account)
    ? account
    : (accounts[0]?.id ?? "");
  const save = useMutation({
    mutationFn: putGrants,
    retry: false,
    onSuccess: async (data) => {
      client.setQueryData(codeAgentKeys.grants(scope), data);
      setFeedback("授权已保存");
      await client.invalidateQueries({
        queryKey: codeAgentKeys.catalog(scope),
      });
    },
    onError: async (cause) => {
      const conflict = cause instanceof ApiError && cause.status === 409;
      setError(
        conflict
          ? "授权已被其他操作更新，正在重新读取，请核对后重新操作。"
          : apiErrorMessage(cause, "授权保存失败，请稍后重试"),
      );
      try {
        await client.invalidateQueries(
          { queryKey: codeAgentKeys.grants(scope) },
          { throwOnError: true },
        );
        if (conflict)
          setError("授权已被其他操作更新，已载入最新授权。请核对后重新操作。");
      } catch {
        setError("无法重新读取授权，请点击重试，确认最新状态后再操作。");
      }
    },
  });
  const disabled =
    save.isPending || grants.isFetching || !!grants.error || !accountId;
  const toggle = (agentId: Grant["agent_id"], purpose: Grant["purpose"]) => {
    const state = grants.data;
    if (!state || disabled) return;
    setFeedback("");
    setError("");
    const key = `${agentId}:${purpose}`;
    const existing = state.managed.includes(key)
      ? state.grants
      : [
          ...state.grants,
          ...state.legacy.filter(
            (g) => g.agent_id === agentId && g.purpose === purpose,
          ),
        ];
    const selected = (g: Grant) =>
      g.user_id === accountId &&
      g.agent_id === agentId &&
      g.purpose === purpose;
    save.mutate({
      expected_revision: state.revision,
      managed: [...new Set([...state.managed, key])],
      grants: existing.some(selected)
        ? existing.filter((g) => !selected(g))
        : [...existing, { user_id: accountId, agent_id: agentId, purpose }],
    });
  };
  return (
    <section
      className="code-agent-section"
      aria-labelledby="agent-grants-heading"
    >
      <div className="code-agent-section-heading">
        <div>
          <h2 id="agent-grants-heading">
            <ShieldCheck size={22} aria-hidden />
            当前空间账号授权
          </h2>
          <p>共享本机 CLI 的登录与额度，按账号与用途授权。</p>
        </div>
        <CustomSelect
          ariaLabel="授权账号"
          value={accountId}
          onChange={(id) => {
            setAccount(id);
            setFeedback("");
          }}
          disabled={disabled}
          options={accounts.map((a) => ({
            value: a.id,
            label: a.name || a.id,
          }))}
        />
      </div>
      <QueryFeedback
        error={grants.error}
        pending={grants.isPending}
        onRetry={() => {
          setError("");
          return grants.refetch();
        }}
      />
      {error && (
        <p className="code-agent-error" role="alert">
          {error}
        </p>
      )}
      {feedback && (
        <p className="code-agent-notice" role="status">
          {feedback}
        </p>
      )}
      {save.isPending && (
        <LoadingState
          label="正在保存授权…"
          variant="region"
          className="code-agent-muted"
        />
      )}
      {grants.data &&
        (!accounts.length ? (
          <p className="code-agent-empty">当前空间暂无可授权账号。</p>
        ) : (
          <>
            <div
              className="code-agent-grants-scroll"
              role="region"
              aria-label="智能体用途授权表"
              tabIndex={0}
            >
              <table className="code-agent-grants-table">
                <thead>
                  <tr>
                    <th scope="col">编程智能体</th>
                    {purposes.map((p) => (
                      <th scope="col" key={p.id}>
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.id}>
                      <th scope="row">
                        <span className="code-agent-grant-name">
                          <AgentLogo id={agent.id} size={16} />
                          {agent.name}
                        </span>
                      </th>
                      {purposes.map((p) => {
                        const supported =
                          agent.id === "codex" ||
                          p.id !== "interview_preparation";
                        const granted = effectiveGrants(
                          grants.data!,
                          `${agent.id}:${p.id}`,
                        ).some(
                          (g) =>
                            g.user_id === accountId &&
                            g.agent_id === agent.id &&
                            g.purpose === p.id,
                        );
                        return (
                          <td key={p.id}>
                            {supported ? (
                              <button
                                type="button"
                                className="code-agent-grant-switch"
                                role="switch"
                                aria-checked={granted}
                                aria-label={`${accounts.find((a) => a.id === accountId)?.name || accountId} · ${agent.name} · ${p.label} 授权`}
                                disabled={disabled}
                                onClick={() => toggle(agent.id, p.id)}
                              >
                                <span>
                                  {granted && <Check size={12} aria-hidden />}
                                </span>
                              </button>
                            ) : (
                              <span className="code-agent-muted">不支持</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="code-agent-muted code-agent-grants-help">
              授权仅适用于当前空间和所选用途。首次修改会保留该用途的其他旧授权并接管管理；撤销后约束后续调用。
            </p>
          </>
        ))}
    </section>
  );
}
