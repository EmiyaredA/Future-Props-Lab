import {
  ArrowRight,
  Check,
  Mail,
  Search,
  ShieldCheck,
  Users,
  ScrollText,
} from "lucide-react";
import { useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ManagementPagination } from "./ManagementUi";
import { roleLabels, workspaceAllows } from "./permissions";
import type { useAccountWorkspacePanel } from "./useAccountWorkspacePanel";

export function WorkspaceDialogContent({
  state,
  guard,
  close,
  openManagement,
  openInvitations,
}: {
  state: ReturnType<typeof useAccountWorkspacePanel>;
  guard: (next: () => void) => void;
  close: () => void;
  openManagement: (
    tab: "members" | "roles" | "audit",
    opener: HTMLButtonElement,
  ) => void;
  openInvitations: (opener: HTMLButtonElement) => void;
}) {
  const {
    me,
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
  } = state;
  const [mobileList, setMobileList] = useState(false);
  const canManage = workspaceAllows(me.workspace, "workspace.manage");
  const dirty =
    workspaceName !== me.workspace.name ||
    visibility !== me.workspace.visibility;
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
          <h3>我的工作空间</h3>
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
                  <span className="workspace-mark" aria-hidden="true">
                    W
                  </span>
                  <span className="workspace-choice-meta">
                    <strong title={w.name}>{w.name}</strong>
                    <small title={w.owner_display_name}>
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
                  <span className="workspace-choice-arrow" aria-hidden="true">
                    {w.id === me.workspace.id ? (
                      <Check size={19} />
                    ) : (
                      <ArrowRight size={18} />
                    )}
                  </span>
                </button>
              ))}
            {state.loading && !workspaces.length ? (
              <p role="status">正在加载工作空间…</p>
            ) : null}
            {!state.loading && !workspaces.length ? (
              <p className="empty-copy">没有匹配的工作空间。</p>
            ) : null}
          </div>
          <ManagementPagination
            total={workspaceTotal}
            page={workspacePage}
            setPage={setWorkspacePage}
          />
          <button
            className="workspace-invitations-entry"
            disabled={busy}
            onClick={(event) => openInvitations(event.currentTarget)}
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
            <div className="workspace-detail-heading">
              <h3>空间设置</h3>
              <p>{me.workspace.name}</p>
            </div>

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
                <div className="workspace-settings-entry">
                  <Users aria-hidden="true" />
                  <span>
                    <strong>成员与邀请</strong>
                    <small>查看空间成员，邀请账号加入协作</small>
                  </span>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={(event) =>
                      openManagement("members", event.currentTarget)
                    }
                  >
                    管理成员
                  </button>
                </div>
              ) : null}
              <div className="workspace-settings-entry workspace-settings-entry-permissions">
                <ShieldCheck aria-hidden="true" />
                <span>
                  <strong>角色与权限</strong>
                  <small>了解四种固定角色的能力与边界</small>
                </span>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={(event) =>
                    openManagement("roles", event.currentTarget)
                  }
                >
                  查看权限 <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
              {workspaceAllows(me.workspace, "audit.read") ? (
                <div className="workspace-settings-entry">
                  <ScrollText aria-hidden="true" />
                  <span>
                    <strong>空间审计</strong>
                    <small>查看当前空间的授权与管理记录</small>
                  </span>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={(event) =>
                      openManagement("audit", event.currentTarget)
                    }
                  >
                    查看审计
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <footer className="account-dialog-actions">
            <button className="btn" onClick={close} disabled={busy}>
              {dirty ? "取消" : "关闭"}
            </button>
            {canManage ? (
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
