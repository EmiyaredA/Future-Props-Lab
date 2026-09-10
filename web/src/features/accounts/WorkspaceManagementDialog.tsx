import { useId, useRef } from "react";
import { Users, ShieldCheck, ScrollText } from "lucide-react";
import { WorkspaceMembersContent } from "./WorkspaceMembersContent";
import { WorkspaceRoleCards } from "./WorkspaceRoleCards";
import { AuditPage } from "./AuditPage";
import { workspaceAllows } from "./permissions";
import type { useAccountWorkspacePanel } from "./useAccountWorkspacePanel";

export function WorkspaceManagementDialog({
  state,
}: {
  state: ReturnType<typeof useAccountWorkspacePanel>;
}) {
  const id = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabs = [
    {
      key: "members",
      label: "成员与邀请",
      Icon: Users,
      visible: workspaceAllows(state.me.workspace, "workspace.manage"),
    },
    { key: "roles", label: "角色与权限", Icon: ShieldCheck, visible: true },
    {
      key: "audit",
      label: "审计记录",
      Icon: ScrollText,
      visible: workspaceAllows(state.me.workspace, "audit.read"),
    },
  ] as const;
  const visibleTabs = tabs.filter((tab) => tab.visible);
  return (
    <>
      <div
        className="workspace-management-tabs"
        ref={tabsRef}
        role="tablist"
        aria-label="工作空间管理"
        onKeyDown={(event) => {
          if (state.busy) return;
          const index = visibleTabs.findIndex(
            (tab) => tab.key === state.managementTab,
          );
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % visibleTabs.length
              : event.key === "ArrowLeft"
                ? (index + visibleTabs.length - 1) % visibleTabs.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? visibleTabs.length - 1
                    : null;
          if (next === null) return;
          event.preventDefault();
          state.clearMessages();
          state.setManagementTab(visibleTabs[next].key);
          tabsRef.current
            ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
            [next]?.focus();
        }}
      >
        {visibleTabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${id}-${key}`}
            aria-controls={`${id}-panel`}
            aria-selected={state.managementTab === key}
            tabIndex={state.managementTab === key ? 0 : -1}
            disabled={state.busy}
            onClick={() => {
              state.clearMessages();
              state.setManagementTab(key);
            }}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div
        key={state.managementTab}
        className="workspace-management-content"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${state.managementTab}`}
        tabIndex={0}
        aria-busy={state.busy || state.loading}
      >
        {state.loading ? (
          <p className="workspace-management-status" role="status">
            正在加载成员与邀请…
          </p>
        ) : null}
        {state.busy ? (
          <p className="workspace-management-status" role="status">
            正在处理，请稍候…
          </p>
        ) : null}
        {state.managementTab === "members" ? (
          <WorkspaceMembersContent state={state} />
        ) : null}
        {state.managementTab === "roles" ? (
          <WorkspaceRoleCards workspace={state.me.workspace} />
        ) : null}
        {state.managementTab === "audit" ? (
          <AuditPage workspaceId={state.me.workspace.id} />
        ) : null}
      </div>
    </>
  );
}
