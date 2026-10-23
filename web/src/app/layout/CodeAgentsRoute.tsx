import { CodeAgentsPage } from "@features/code-agents/CodeAgentsPage";
import type { StudioPage } from "@app/routes";
import { ModelInfrastructureHeader } from "./ModelInfrastructureHeader";

export function CodeAgentsRoute({
  user,
  workspaceId,
  navigate,
  focusSelected,
}: {
  user: { id: string; platform_role?: string };
  workspaceId: string;
  navigate: (page: StudioPage, keyboard?: boolean) => void;
  focusSelected?: boolean;
}) {
  const scope = `${user.id}:${workspaceId}`;
  return (
    <CodeAgentsPage
      key={scope}
      scope={scope}
      canManage={["admin", "super_admin"].includes(user.platform_role || "")}
      renderHeader={(actions) => (
        <ModelInfrastructureHeader
          page="code-agents"
          navigate={navigate}
          focusSelected={focusSelected}
          actions={actions}
        />
      )}
    />
  );
}
