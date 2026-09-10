import type { AccountSessionContext } from "./api";
import "./account-navigation.css";
export function WorkspaceTrigger({
  session,
}: {
  session: AccountSessionContext;
}) {
  const workspace = session.me.workspace;
  return (
    <button
      type="button"
      className="workspace-trigger"
      aria-haspopup="dialog"
      aria-label={`${workspace.name}，切换工作空间`}
      onClick={() =>
        window.dispatchEvent(new Event("future-props:open-workspace"))
      }
    >
      <span className="workspace-mark" aria-hidden="true">
        W
      </span>
      <span className="workspace-trigger-copy">
        <strong title={workspace.name}>{workspace.name}</strong>
        <small>切换工作空间</small>
      </span>
    </button>
  );
}
