import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { components } from "@generated/api";
import { accountQueryKeys } from "./queryKeys";
import {
  fetchPolicy,
  fetchQuotas,
  savePolicy,
  saveQuotas,
} from "./platformApi";
import { ManagementError } from "./ManagementUi";
import { useManagementDraft } from "./useManagementDraft";
type Policy = components["schemas"]["PermissionPolicy"];
const capabilities: {
  key: keyof Policy["admin"];
  label: string;
  description: string;
}[] = [
  {
    key: "view_cross_workspace_logs",
    label: "跨工作区日志",
    description: "通过明确的空间选择查看调用记录，仅浏览器会话可用。",
  },
  {
    key: "view_model_diagnostics",
    label: "完整模型诊断",
    description: "查看原始模型请求、响应和诊断下载包。",
  },
  {
    key: "view_realtime_voice_diagnostics",
    label: "实时语音诊断",
    description: "查看实时语音的诊断详情，正常模型测试仍由工作区角色授权。",
  },
  {
    key: "view_sensitive_tool_results",
    label: "敏感工具详情",
    description: "查看被标记为敏感的工具返回内容。",
  },
  {
    key: "view_developer_docs",
    label: "开发者文档",
    description: "访问架构和部署文档的目录、搜索与正文。",
  },
  {
    key: "mark_workshop_official",
    label: "官方作品认证",
    description: "为有写权限的视觉与 Galgame 项目添加或撤销官方标记。",
  },
];
export function PermissionPolicyPage() {
  const policy = useQuery({
    queryKey: accountQueryKeys.policy,
    queryFn: fetchPolicy,
  });
  const quotas = useQuery({
    queryKey: accountQueryKeys.quotas,
    queryFn: fetchQuotas,
  });
  return (
    <section className="management-page">
      <header className="management-page-head">
        <div>
          <h1>权限策略</h1>
          <p>按平台身份配置敏感能力和并发额度，保存后作用于新请求。</p>
        </div>
      </header>
      <div className="governance-role-strip">
        {[
          "超级管理员 · 完整平台治理",
          "运营管理员 · 跨空间运营",
          "普通用户 · 工作区协作",
        ].map((label) => (
          <div key={label}>
            <ShieldCheck size={21} />
            <strong>{label}</strong>
          </div>
        ))}
      </div>
      <ManagementError error={policy.error || quotas.error} />
      {(policy.isError || quotas.isError) && (
        <button
          className="btn"
          onClick={() => {
            void policy.refetch();
            void quotas.refetch();
          }}
        >
          重新加载
        </button>
      )}
      {policy.data ? (
        <PolicyEditor initial={policy.data} />
      ) : (
        <p className="empty-copy">正在加载权限…</p>
      )}
      {quotas.data && <QuotaEditor initial={quotas.data} />}
    </section>
  );
}
function PolicyEditor({
  initial,
}: {
  initial: Awaited<ReturnType<typeof fetchPolicy>>;
}) {
  const cache = useQueryClient();
  const [current, setCurrent] = useState(initial);
  const [draft, setDraft] = useState(initial.value);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(current.value) !== JSON.stringify(draft);
  useManagementDraft("permission-policy", dirty);
  return (
    <form
      className="management-list-panel governance-panel"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void savePolicy({ expected_revision: current.revision, value: draft })
          .then((result) => {
            setCurrent(result);
            setDraft(result.value);
            void cache.invalidateQueries({ queryKey: accountQueryKeys.policy });
            window.dispatchEvent(new Event("focus"));
          })
          .catch(setError)
          .finally(() => setBusy(false));
      }}
    >
      <header>
        <ShieldCheck size={22} />
        <div>
          <h2>权限矩阵</h2>
          <p>空间角色决定日常操作能力，平台策略进一步控制敏感信息。</p>
        </div>
      </header>
      <div className="governance-matrix-scroll">
        <table className="management-table governance-matrix">
          <thead>
            <tr>
              <th>能力</th>
              <th>超级管理员</th>
              <th>运营管理员</th>
              <th>普通用户</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>管理中台访问</strong>
                <small>账号、平台策略及全局配置</small>
              </td>
              <td>固定开启</td>
              <td>不可访问</td>
              <td>不可访问</td>
            </tr>
            {capabilities.map((cap) => (
              <tr key={cap.key}>
                <td>
                  <strong>{cap.label}</strong>
                  <small>{cap.description}</small>
                </td>
                <td>固定开启</td>
                {(["admin", "member"] as const).map((role) => (
                  <td key={role}>
                    {role === "member" &&
                    cap.key === "mark_workshop_official" ? (
                      "不可使用"
                    ) : (
                      <button
                        className={`governance-switch ${draft[role][cap.key] ? "is-on" : ""}`}
                        type="button"
                        role="switch"
                        aria-checked={draft[role][cap.key]}
                        aria-label={`${role === "admin" ? "运营管理员" : "普通用户"} · ${cap.label}`}
                        disabled={busy}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            [role]: {
                              ...draft[role],
                              [cap.key]: !draft[role][cap.key],
                            },
                          })
                        }
                      >
                        <span />
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ManagementError error={error} />
      <footer>
        <span>{dirty ? "有尚未保存的更改" : "权限策略已保存"}</span>
        <div className="button-row">
          {!!error && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                void fetchPolicy()
                  .then((latest) => {
                    setCurrent(latest);
                    setError(null);
                  })
                  .catch(setError)
              }
            >
              读取最新版本，保留草稿
            </button>
          )}
          <button className="btn primary" disabled={busy || !dirty}>
            保存权限策略
          </button>
        </div>
      </footer>
    </form>
  );
}
function QuotaEditor({
  initial,
}: {
  initial: Awaited<ReturnType<typeof fetchQuotas>>;
}) {
  const [current, setCurrent] = useState(initial);
  const [draft, setDraft] = useState(initial.value);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(current.value) !== JSON.stringify(draft);
  useManagementDraft("runtime-quotas", dirty);
  return (
    <form
      className="management-list-panel governance-panel"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void saveQuotas({ expected_revision: current.revision, value: draft })
          .then((result) => {
            setCurrent(result);
            setDraft(result.value);
          })
          .catch(setError)
          .finally(() => setBusy(false));
      }}
    >
      <header>
        <SlidersHorizontal size={22} />
        <div>
          <h2>并发配额</h2>
          <p>
            图片和视频额度不足时自动排队；等待上限按账号跨工作区合计，0
            表示关闭排队。其他调用额度不足时拒绝。
          </p>
        </div>
      </header>
      <div className="governance-quota-grid">
        {(
          [
            ["member", "普通用户"],
            ["admin", "运营管理员"],
            ["super_admin", "超级管理员"],
            ["instance", "整个平台"],
          ] as const
        ).map(([role, label]) => (
          <fieldset key={role}>
            <legend>{label}</legend>
            {(["total", "realtime_voice"] as const).map((key) => (
              <label key={key}>
                {key === "total" ? "总并发" : "实时语音"}
                <input
                  type="number"
                  min={role === "instance" && key === "total" ? 1 : 0}
                  max={1024}
                  required
                  value={draft[role][key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [role]: { ...draft[role], [key]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
            {role !== "instance" && (
              <label>
                图片／视频等待上限
                <input
                  type="number"
                  min={0}
                  max={1024}
                  required
                  value={draft.generation_queue?.[role] ?? 20}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      generation_queue: {
                        member: 20,
                        admin: 20,
                        super_admin: 20,
                        ...draft.generation_queue,
                        [role]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            )}
          </fieldset>
        ))}
        <label>
          每个工作区总并发
          <input
            type="number"
            min={1}
            max={1024}
            required
            value={draft.workspace_total}
            onChange={(e) =>
              setDraft({ ...draft, workspace_total: Number(e.target.value) })
            }
          />
        </label>
        <label>
          管理员预留总额度
          <input
            type="number"
            min={0}
            max={1024}
            required
            value={draft.reserved_for_admins}
            onChange={(e) =>
              setDraft({
                ...draft,
                reserved_for_admins: Number(e.target.value),
              })
            }
          />
        </label>
      </div>
      <ManagementError error={error} />
      <footer>
        <span>{dirty ? "有尚未保存的更改" : "并发额度已保存"}</span>
        <div className="button-row">
          {!!error && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                void fetchQuotas()
                  .then((latest) => {
                    setCurrent(latest);
                    setError(null);
                  })
                  .catch(setError)
              }
            >
              读取最新版本，保留草稿
            </button>
          )}
          <button className="btn primary" disabled={busy || !dirty}>
            保存并发配额
          </button>
        </div>
      </footer>
    </form>
  );
}
