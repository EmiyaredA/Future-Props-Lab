import { useStudioSession } from "@app/StudioSession";
import { ModelInfrastructureHeader } from "@app/layout/ModelInfrastructureHeader";
import { CodeAgentsPage } from "@features/code-agents/CodeAgentsPage";
import { StudioServiceShell } from "./StudioServiceShell";
import {
  navigateModelInfrastructure,
  useModelInfrastructureFocus,
} from "./modelInfrastructureNavigation";

export default function AgentRuntimeApplication() {
  const { me } = useStudioSession();
  const focusSelected = useModelInfrastructureFocus("code-agents");
  return (
    <StudioServiceShell title="编程智能体">
      <CodeAgentsPage
        canManage={me.user.is_platform_admin}
        scope={me.user.id}
        renderHeader={(actions) => (
          <ModelInfrastructureHeader
            page="code-agents"
            navigate={navigateModelInfrastructure}
            focusSelected={focusSelected}
            actions={actions}
          />
        )}
      />
    </StudioServiceShell>
  );
}
