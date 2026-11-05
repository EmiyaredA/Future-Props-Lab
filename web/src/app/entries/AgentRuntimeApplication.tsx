import { useStudioSession } from "@app/StudioSession";
import { CodeAgentsPage } from "@features/code-agents/CodeAgentsPage";
import { IndependentShell } from "./IndependentShell";

export default function AgentRuntimeApplication() {
  const { me } = useStudioSession();
  return (
    <IndependentShell title="编程智能体">
      <CodeAgentsPage
        canManage={me.user.is_platform_admin}
        scope={me.user.id}
      />
    </IndependentShell>
  );
}
