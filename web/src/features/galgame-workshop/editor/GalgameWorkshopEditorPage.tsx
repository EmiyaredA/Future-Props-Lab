import { GalgameWorkshopEditorView } from "@features/galgame-workshop/editor/GalgameWorkshopEditorView";
import { useGalgameWorkshopEditorController } from "@features/galgame-workshop/editor/useGalgameWorkshopEditorController";

type EditorPageProps = Parameters<typeof useGalgameWorkshopEditorController>[0];

export function GalgameWorkshopEditorPage(props: EditorPageProps) {
  return (
    <GalgameWorkshopEditorView
      model={useGalgameWorkshopEditorController(props)}
    />
  );
}
