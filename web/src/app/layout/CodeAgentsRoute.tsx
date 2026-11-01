import { CodeAgentsPage } from "@features/code-agents/CodeAgentsPage";
import type { StudioPage } from "@app/routes";
import { ModelInfrastructureHeader } from "./ModelInfrastructureHeader";

export function CodeAgentsRoute({
  user,
  accountId,
  navigate,
  focusSelected,
}: {
  user: { id: string; platform_role?: string };
  accountId: string;
  navigate: (page: StudioPage, keyboard?: boolean) => void;
  focusSelected?: boolean;
}) {
  const scope = `${user.id}:${accountId}`;
  return (
    <CodeAgentsPage
      key={scope}
      scope={scope}
      canManage={["admin", "admin"].includes(user.platform_role || "")}
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
