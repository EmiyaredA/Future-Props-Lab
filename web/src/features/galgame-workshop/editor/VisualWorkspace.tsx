import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { VisualWorkspaceView } from "@features/galgame-workshop/editor/VisualWorkspaceView";
import { useVisualWorkspaceController } from "@features/galgame-workshop/editor/useVisualWorkspaceController";

type VisualWorkspaceProps = Parameters<typeof useVisualWorkspaceController>[0];

export function VisualWorkspace(props: VisualWorkspaceProps) {
  const model = useVisualWorkspaceController(props);
  return (
    <>
      <TransferFeedback progress={model.transferProgress} />
      <VisualWorkspaceView model={model} />
    </>
  );
}
