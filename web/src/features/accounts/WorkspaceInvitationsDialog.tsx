import { Mail, Inbox } from "lucide-react";
import { respondToInvitation } from "./api";
import { roleLabels } from "./permissions";
import { formatAccountDate } from "./formatAccountDate";
import type { useAccountWorkspacePanel } from "./useAccountWorkspacePanel";

export function WorkspaceInvitationsDialog({
  state,
}: {
  state: ReturnType<typeof useAccountWorkspacePanel>;
}) {
  const pending = state.invitations.filter(
    (invitation) => invitation.status === "pending",
  );
  return (
    <div
      className="workspace-management-content workspace-received-invitations"
      aria-busy={state.loading || state.busy}
    >
      {state.loading ? <p role="status">正在加载邀请…</p> : null}
      {state.busy ? <p role="status">正在处理邀请…</p> : null}
      {pending.map((invitation) => (
        <article className="workspace-invitation-card" key={invitation.id}>
          <span className="workspace-member-avatar">
            <Mail size={22} aria-hidden="true" />
          </span>
          <div className="workspace-person-copy">
            <h3>{invitation.workspace_name}</h3>
            <p>
              {roleLabels[invitation.role]} · 有效期至{" "}
              {formatAccountDate(invitation.expires_at)}
            </p>
          </div>
          <div className="workspace-member-actions">
            {(["decline", "accept"] as const).map((action) => (
              <button
                type="button"
                key={action}
                className={`btn small${action === "accept" ? " primary" : ""}`}
                disabled={state.busy}
                onClick={() =>
                  void state.report(async () => {
                    await respondToInvitation(invitation, action);
                    await state.loadInvitations();
                  })
                }
              >
                {action === "accept" ? "接受" : "拒绝"}
              </button>
            ))}
          </div>
        </article>
      ))}
      {!state.loading && !state.error && !pending.length ? (
        <div className="workspace-management-empty">
          <Inbox size={32} aria-hidden="true" />
          <h3>没有待处理邀请</h3>
          <p>收到工作空间邀请后，可以在这里查看并接受。</p>
        </div>
      ) : null}
    </div>
  );
}
