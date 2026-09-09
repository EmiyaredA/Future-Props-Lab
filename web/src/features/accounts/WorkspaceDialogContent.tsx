import {
  ArrowLeft,
  ArrowRight,
  Check,
  Layers,
  Mail,
  Search,
  ShieldCheck,
  Users,
  ScrollText,
} from "lucide-react";
import { useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ManagementPagination } from "./ManagementUi";
import { WorkspaceMembersContent } from "./WorkspaceMembersContent";
import { AuditPage } from "./AuditPage";
import { respondToInvitation } from "./api";
import { roleLabels, workspaceAllows } from "./permissions";
import type { useAccountWorkspacePanel } from "./useAccountWorkspacePanel";
import { formatAccountDate } from "./formatAccountDate";

export function WorkspaceDialogContent({
  state,
  guard,
  close,
}: {
  state: ReturnType<typeof useAccountWorkspacePanel>;
  guard: (next: () => void) => void;
  close: () => void;
}) {
  const {
    me,
    tab,
    setTab,
    busy,
    workspaces,
    workspaceQuery,
    setWorkspaceQuery,
    workspacePage,
    setWorkspacePage,
    workspaceTotal,
    invitations,
    workspaceName,
    setWorkspaceName,
    visibility,
    setVisibility,
    saveWorkspace,
    switchWorkspace,
    report,
    loadWorkspaces,
  } = state;
  const [mobileList, setMobileList] = useState(false);
  const canManage = workspaceAllows(me.workspace, "workspace.manage");
  const dirty =
    workspaceName !== me.workspace.name ||
    visibility !== me.workspace.visibility;
  const titles: Record<string, string> = {
    overview: "空间设置",
    members: "成员与邀请",
    roles: "角色与权限",
    audit: "空间审计",
    invitations: "我收到的邀请",
  };
  return (
    <>
      <div className="workspace-mobile-tabs">
        <button
          className={mobileList ? "active" : ""}
          onClick={() => setMobileList(true)}
        >
          空间列表
        </button>
        <button
          className={!mobileList ? "active" : ""}
          onClick={() => setMobileList(false)}
        >
          当前空间
        </button>
      </div>
      <div
        className={`workspace-dialog-body ${mobileList ? "show-list" : "show-detail"}`}
      >
        <aside className="workspace-dialog-switcher">
          <h3>我的工作区</h3>
          <label className="management-search">
            <Search size={18} />
            <input
              aria-label="搜索可访问的空间"
              placeholder="搜索名称或拥有者"
              value={workspaceQuery}
              onChange={(e) => {
                setWorkspaceQuery(e.target.value);
                setWorkspacePage(1);
              }}
            />
          </label>
          <div className="workspace-choice-list" aria-busy={state.loading}>
            {[...workspaces]
              .sort(
                (a, b) =>
                  Number(b.id === me.workspace.id) -
                  Number(a.id === me.workspace.id),
              )
              .map((w) => (
                <button
                  type="button"
                  key={w.id}
                  disabled={busy}
                  className={`workspace-choice ${w.id === me.workspace.id ? "is-current" : ""}`}
                  onClick={() => {
                    if (w.id === me.workspace.id) {
                      setMobileList(false);
                      return;
                    }
                    guard(() => {
                      void report(() => switchWorkspace(w.id));
                    });
                  }}
                >
                  <span className="workspace-mark">
                    <Layers size={22} />
                  </span>
                  <span className="workspace-choice-meta">
                    <strong>{w.name}</strong>
                    <small>
                      {w.owner_display_name} ·{" "}
                      {w.visibility === "public" ? "公开展台" : "私有"}
                    </small>
                    <span className="workspace-badges">
                      {w.id === me.workspace.id ? <em>当前</em> : null}
                      <em>
                        {w.role
                          ? roleLabels[w.role]
                          : w.access_kind === "public_viewer"
                            ? "公开访客"
                            : "平台管理员"}
                      </em>
                    </span>
                  </span>
                  <span className="workspace-choice-arrow">
                    {w.id === me.workspace.id ? (
                      <Check size={19} />
                    ) : (
                      <ArrowRight size={18} />
                    )}
                  </span>
                </button>
              ))}
            {state.loading && !workspaces.length ? (
              <p role="status">正在加载工作区…</p>
            ) : null}
            {!state.loading && !workspaces.length ? (
              <p className="empty-copy">没有匹配的工作区。</p>
            ) : null}
          </div>
          <ManagementPagination
            total={workspaceTotal}
            page={workspacePage}
            setPage={setWorkspacePage}
          />
          <button
            className="workspace-invitations-entry"
            onClick={() => {
              setTab("invitations");
              setMobileList(false);
            }}
          >
            <Mail size={18} />
            我收到的邀请
            <span>
              {invitations.filter((i) => i.status === "pending").length}
            </span>
          </button>
        </aside>
        <div className="workspace-dialog-detail">
          <div className="workspace-detail-scroll">
            {tab !== "overview" ? (
              <button
                className="account-back-link"
                onClick={() => setTab("overview")}
              >
                <ArrowLeft size={16} />
                返回空间设置
              </button>
            ) : null}
            <div className="workspace-detail-heading">
              <h3>{titles[tab] || "空间设置"}</h3>
              <p>{me.workspace.name}</p>
            </div>
            {tab === "overview" ? (
              <>
                {canManage ? (
                  <form
                    id="workspace-settings"
                    className="workspace-settings-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveWorkspace();
                    }}
                  >
                    <label>
                      空间名称
                      <input
                        value={workspaceName}
                        maxLength={255}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                      />
                    </label>
                    <label>
                      访问范围
                      <CustomSelect
                        ariaLabel="访问范围"
                        value={visibility}
                        options={[
                          {
                            value: "private",
                            label: "私有：仅成员和平台管理员",
                          },
                          {
                            value: "public",
                            label: "公开：展示允许公开的内容",
                          },
                        ]}
                        onChange={(value) =>
                          setVisibility(value as "private" | "public")
                        }
                      />
                    </label>
                    <p className="account-field-hint">
                      公开展台仅展示允许公开的内容，不授予内部浏览或编辑权限。
                    </p>
                  </form>
                ) : (
                  <div className="workspace-readonly-info">
                    <strong>
                      {me.workspace.role
                        ? roleLabels[me.workspace.role]
                        : "公开访客"}
                    </strong>
                    <p>
                      你可以按当前角色访问此空间。空间设置由拥有者、工作区管理员或平台管理员维护。
                    </p>
                  </div>
                )}
                <div className="workspace-settings-entries">
                  {canManage ? (
                    <button onClick={() => setTab("members")}>
                      <Users />
                      <span>
                        <strong>成员与邀请</strong>
                        <small>查看空间成员，邀请账号加入协作</small>
                      </span>
                      <ArrowRight size={18} />
                    </button>
                  ) : null}
                  <button onClick={() => setTab("roles")}>
                    <ShieldCheck />
                    <span>
                      <strong>角色与权限</strong>
                      <small>了解四种固定角色的能力与边界</small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                  {workspaceAllows(me.workspace, "audit.read") ? (
                    <button onClick={() => setTab("audit")}>
                      <ScrollText />
                      <span>
                        <strong>空间审计</strong>
                        <small>查看当前空间的授权与管理记录</small>
                      </span>
                      <ArrowRight size={18} />
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
            {tab === "members" && canManage ? (
              <WorkspaceMembersContent state={state} />
            ) : null}
            {tab === "roles" ? <WorkspaceRoleGuide /> : null}
            {tab === "audit" && workspaceAllows(me.workspace, "audit.read") ? (
              <AuditPage workspaceId={me.workspace.id} />
            ) : null}
            {tab === "invitations" ? (
              <div className="settings-section">
                {invitations
                  .filter((i) => i.status === "pending")
                  .map((i) => (
                    <div className="settings-row" key={i.id}>
                      <span>
                        <strong>{i.workspace_name}</strong>
                        <small>
                          {roleLabels[i.role]} · 有效期至{" "}
                          {formatAccountDate(i.expires_at)}
                        </small>
                      </span>
                      <div className="button-row">
                        {(["accept", "decline"] as const).map((action) => (
                          <button
                            className={`btn small ${action === "accept" ? "primary" : ""}`}
                            key={action}
                            disabled={busy}
                            onClick={() =>
                              void report(async () => {
                                await respondToInvitation(i, action);
                                await loadWorkspaces();
                              })
                            }
                          >
                            {action === "accept" ? "接受" : "拒绝"}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                {!invitations.some((i) => i.status === "pending") ? (
                  <p className="empty-copy">没有待处理邀请。</p>
                ) : null}
              </div>
            ) : null}
          </div>
          <footer className="account-dialog-actions">
            <button className="btn" onClick={close} disabled={busy}>
              {dirty ? "取消" : "关闭"}
            </button>
            {canManage && tab === "overview" ? (
              <button
                className="btn primary"
                type="submit"
                form="workspace-settings"
                disabled={busy || !dirty || !workspaceName.trim()}
              >
                {busy ? "保存中…" : "保存更改"}
              </button>
            ) : null}
          </footer>
        </div>
      </div>
    </>
  );
}

function WorkspaceRoleGuide() {
  const capabilities = [
    ["浏览内容、素材与已有结果", 4],
    ["编辑、上传、删除与生成任务", 3],
    ["模型调用与实时语音测试", 3],
    ["模型配置与集成", 2],
    ["完整调用日志、诊断与审计", 2],
    ["空间设置与普通成员管理", 2],
    ["授予或撤销工作区管理员", 1],
  ] as const;
  return (
    <>
      <div className="workspace-role-table">
        <table>
          <thead>
            <tr>
              <th>能力</th>
              {Object.values(roleLabels).map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {capabilities.map(([name, count]) => (
              <tr key={name}>
                <td>{name}</td>
                {[0, 1, 2, 3].map((i) => (
                  <td key={i}>{i < count ? "✓" : "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="account-field-hint">
        平台管理员可管理全部空间。工作区管理员只能管理协作者和只读成员，不能修改自身、拥有者或其他管理员的角色。
      </p>
    </>
  );
}
