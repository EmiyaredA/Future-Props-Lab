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
  } = state;
  const canAssignAdmin = workspaceAllows(me.workspace, "members.assign_admin");
  const canChangeMember = (role: string, userId: string) =>
    userId !== me.user.id &&
    role !== "owner" &&
    (role !== "admin" || canAssignAdmin);
  const options = roleOptions.filter(
    (o) => o.value !== "admin" || canAssignAdmin,
  );
  return (
    <>
      <section className="settings-section">
        <h3>空间成员</h3>
        {members.map((member) => (
          <div className="settings-row" key={member.membership_id}>
            <span>
              <strong>{member.display_name}</strong>
              <small>
                @{member.username} · {roleLabels[member.role]}
              </small>
            </span>
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
            ) : null}
          </div>
        ))}
      </section>
      <form className="settings-section" onSubmit={(e) => void invite(e)}>
        <h3>邀请已有账号</h3>
        <p>邀请账号加入当前空间，并为其选择合适的角色。</p>
        <label>
          用户名
          <input
            value={inviteUsername}
            onChange={(e) => setInviteUsername(e.target.value)}
          />
        </label>
        <CustomSelect
          ariaLabel="邀请角色"
          value={inviteRole}
          options={options}
          onChange={(role) =>
            setInviteRole(role as "admin" | "member" | "viewer")
          }
        />
        <button
          className="btn primary"
          disabled={busy || !inviteUsername.trim()}
        >
          发送邀请
        </button>
      </form>
      <section className="settings-section">
        <h3>当前空间发出的邀请</h3>
        {sentInvitations
          .filter((i) => i.status === "pending")
          .map((i) => (
            <div className="settings-row" key={i.id}>
              <span>
                <strong>@{i.invitee_username}</strong>
                <small>
                  {roleLabels[i.role]} · 等待接受 ·{" "}
                  {formatAccountDate(i.expires_at)} 到期
                </small>
              </span>
              <button
                className="btn small danger"
                disabled={busy}
                onClick={() =>
                  void report(async () => {
                    await revokeWorkspaceInvitation(i);
                    await loadGovernance();
                  })
                }
              >
                撤销
              </button>
            </div>
          ))}
        {!sentInvitations.some((i) => i.status === "pending") ? (
          <p>没有待处理的空间邀请。</p>
        ) : null}
      </section>
    </>
  );
}
