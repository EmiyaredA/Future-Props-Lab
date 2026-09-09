import { ChevronsUpDown, Layers } from "lucide-react";
import type { AccountSessionContext } from "./api";
import { roleLabels } from "./permissions";
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
      onClick={() =>
        window.dispatchEvent(new Event("future-props:open-workspace"))
      }
    >
      <span className="workspace-mark">
        <Layers size={21} />
      </span>
      <span>
        <strong>{workspace.name}</strong>
        <small>
          {workspace.role
            ? roleLabels[workspace.role]
            : workspace.access_kind === "public_viewer"
              ? "公开展台"
              : "平台管理员"}{" "}
          · 切换工作区
        </small>
      </span>
      <ChevronsUpDown size={15} />
    </button>
  );
}
