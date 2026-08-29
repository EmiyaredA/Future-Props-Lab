import type { VisualWorkshopCanvasPageProps } from "@features/visual-workshop/canvas/visualCanvasTypes";
import { useVisualCanvasController } from "@features/visual-workshop/canvas/useVisualCanvasController";
import { VisualWorkshopCanvasView } from "@features/visual-workshop/canvas/VisualWorkshopCanvasView";

export function VisualWorkshopCanvasPage(props: VisualWorkshopCanvasPageProps) {
  const controller = useVisualCanvasController(props);
  return <VisualWorkshopCanvasView controller={controller} />;
}
