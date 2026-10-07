import type { VisualWorkshopCanvasPageProps } from "@features/visual-workshop/canvas/visualCanvasTypes";
import { useVisualCanvasController } from "@features/visual-workshop/canvas/useVisualCanvasController";
import { VisualWorkshopCanvasView } from "@features/visual-workshop/canvas/VisualWorkshopCanvasView";
import { useState } from "react";
import { ProjectBoard } from "@features/visual-workshop/board/ProjectBoard";
import type { VisualNodeOutput } from "../api";

export function VisualWorkshopCanvasPage(props: VisualWorkshopCanvasPageProps) {
  const controller = useVisualCanvasController(props);
  const [historyPreviews, setHistoryPreviews] = useState<{
    projectId: string;
    items: Record<string, VisualNodeOutput | undefined>;
  }>({ projectId: props.projectId, items: {} });
  const [view, setView] = useState<"canvas" | "board">(() =>
    localStorage.getItem(`visual-project-view:${props.projectId}`) === "board"
      ? "board"
      : "canvas",
  );
  const switchView = (next: "canvas" | "board") => {
    localStorage.setItem(`visual-project-view:${props.projectId}`, next);
    setView(next);
  };
  return view === "board" ? (
    <ProjectBoard
      controller={controller}
      onCanvas={() => switchView("canvas")}
      previews={
        historyPreviews.projectId === props.projectId
          ? historyPreviews.items
          : {}
      }
      onPreview={(nodeId, version) =>
        setHistoryPreviews((current) => ({
          projectId: props.projectId,
          items: {
            ...(current.projectId === props.projectId ? current.items : {}),
            [nodeId]: version,
          },
        }))
      }
    />
  ) : (
    <VisualWorkshopCanvasView
      controller={controller}
      onBoard={() => switchView("board")}
    />
  );
}
