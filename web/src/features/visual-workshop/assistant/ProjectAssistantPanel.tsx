import type { ProjectAssistantPanelProps } from "@features/visual-workshop/assistant/projectAssistantTypes";
import { useProjectAssistantController } from "@features/visual-workshop/assistant/useProjectAssistantController";
import { ProjectAssistantPanelView } from "@features/visual-workshop/assistant/ProjectAssistantPanelView";

export function ProjectAssistantPanel(props: ProjectAssistantPanelProps) {
  const controller = useProjectAssistantController(props);
  return <ProjectAssistantPanelView controller={controller} />;
}
