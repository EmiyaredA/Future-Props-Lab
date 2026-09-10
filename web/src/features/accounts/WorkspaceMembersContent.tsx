import { UserPlus, Users, Mail } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { patchMemberRole } from "./managementApi";
import { removeWorkspaceMember, revokeWorkspaceInvitation } from "./api";
import { roleLabels, roleOptions, workspaceAllows } from "./permissions";
import { formatAccountDate } from "./formatAccountDate";
import type { useAccountWorkspacePanel } from "./useAccountWorkspacePanel";

export function WorkspaceMembersContent({
  state,
}: {
  state: ReturnType<typeof useAccountWorkspacePanel>;
}) {
  const {
    me,
    members,
    sentInvitations,
    report,
    loadGovernance,
    invite,
    inviteRole,
    setInviteRole,
    inviteUsername,
    setInviteUsername,
    busy,
    loading,
    error,
  } = state;
  const canAssignAdmin = workspaceAllows(me.workspace, "members.assign_admin");
  const canChangeMember = (role: string, userId: string) =>
    userId !== me.user.id &&
    role !== "owner" &&
    (role !== "admin" || canAssignAdmin);
  const options = roleOptions.filter(
    (option) => option.value !== "admin" || canAssignAdmin,
  );
  const pending = sentInvitations.filter(
    (invitation) => invitation.status === "pending",
  );
  return (
    <div className="workspace-members-content">
      <section className="workspace-invite-section" aria-label="邀请已有账号">
        <header>
          <UserPlus size={20} aria-hidden="true" />
          <div>
            <h3>邀请已有账号</h3>
            <p>选择角色，邀请账号加入当前工作空间。</p>
          </div>
        </header>
        <form
          className="workspace-invite-form"
          onSubmit={(event) => void invite(event)}
        >
          <label>
            用户名
            <input
              value={inviteUsername}
              disabled={busy}
              placeholder="输入账号用户名"
              onChange={(event) => setInviteUsername(event.target.value)}
            />
          </label>
          <div className="workspace-invite-role">
            <span id="workspace-invite-role-label">邀请角色</span>
            <CustomSelect
              ariaLabel="邀请角色"
              value={inviteRole}
              options={options}
              disabled={busy}
              onChange={(role) =>
                setInviteRole(role as "admin" | "member" | "viewer")
              }
            />
          </div>
          <button
            className="btn primary"
            disabled={busy || !inviteUsername.trim()}
          >
            发送邀请
          </button>
        </form>
      </section>
      <section className="workspace-member-section" aria-label="空间成员">
        <header>
          <Users size={19} aria-hidden="true" />
          <h3>空间成员</h3>
        </header>
        <div className="workspace-member-list">
          {members.map((member) => (
            <article
              className="workspace-member-row"
              key={member.membership_id}
            >
              <span className="workspace-member-avatar" aria-hidden="true">
                {(member.display_name || member.username).slice(0, 1)}
              </span>
              <div className="workspace-person-copy">
                <strong>{member.display_name}</strong>
                <small>
                  @{member.username}
                  {member.user_id === me.user.id ? " · 我" : ""}
                </small>
              </div>
              {canChangeMember(member.role, member.user_id) ? (
                <>
                  <CustomSelect
                    ariaLabel={`修改 ${member.username} 的工作区角色`}
                    value={member.role}
                    options={options}
                    disabled={busy}
                    onChange={(role) =>
                      void report(async () => {
                        await patchMemberRole(member.membership_id, {
                          role: role as "admin" | "member" | "viewer",
                          expected_revision: member.revision,
                        });
                        await loadGovernance();
                      })
                    }
                  />
                  <button
                    className="btn small danger"
                    disabled={busy}
                    aria-label={`移除 ${member.username}`}
                    onClick={() =>
                      void report(async () => {
                        await removeWorkspaceMember(member);
                        await loadGovernance();
                      })
                    }
                  >
                    移除
                  </button>
                </>
              ) : (
                <span className="workspace-member-role">
                  {roleLabels[member.role]}
                </span>
              )}
            </article>
          ))}
        </div>
        {!loading && !error && !members.length ? (
          <p className="workspace-empty-copy">暂无可显示的成员。</p>
        ) : null}
      </section>
      <section
        className="workspace-member-section"
        aria-label="当前空间发出的邀请"
      >
        <header>
          <Mail size={19} aria-hidden="true" />
          <h3>当前空间发出的邀请</h3>
        </header>
        {pending.map((invitation) => (
          <article className="workspace-sent-invitation" key={invitation.id}>
            <div className="workspace-person-copy">
              <strong>@{invitation.invitee_username}</strong>
              <small>
                {roleLabels[invitation.role]} · 等待接受 ·{" "}
                {formatAccountDate(invitation.expires_at)} 到期
              </small>
            </div>
            <button
              className="btn small danger"
              disabled={busy}
              aria-label={`撤销对 ${invitation.invitee_username} 的邀请`}
              onClick={() =>
                void report(async () => {
                  await revokeWorkspaceInvitation(invitation);
                  await loadGovernance();
                })
              }
            >
              撤销
            </button>
          </article>
        ))}
        {!loading && !error && !pending.length ? (
          <p className="workspace-empty-copy">没有待处理的空间邀请。</p>
        ) : null}
      </section>
    </div>
  );
}
