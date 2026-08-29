import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { useDialogueStyleController } from "@features/galgame-workshop/editor/presentation/useDialogueStyleController";
import { DialogueStyleInspectorView } from "@features/galgame-workshop/editor/presentation/DialogueStyleInspectorView";

export function DialogueStyleInspector(props: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
}) {
  const controller = useDialogueStyleController(props);
  return <DialogueStyleInspectorView controller={controller} />;
}
