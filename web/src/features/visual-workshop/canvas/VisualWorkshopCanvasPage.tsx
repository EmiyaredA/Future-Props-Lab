import type { VisualWorkshopCanvasPageProps } from "@features/visual-workshop/canvas/visualCanvasTypes";
import { useVisualCanvasController } from "@features/visual-workshop/canvas/useVisualCanvasController";
import { VisualWorkshopCanvasView } from "@features/visual-workshop/canvas/VisualWorkshopCanvasView";
import { AcceptanceWorkspace } from "../acceptance/AcceptanceWorkspace";
import { useState } from "react";
import { ProjectBoard } from "@features/visual-workshop/board/ProjectBoard";
import type { VisualNodeOutput } from "../api";

export function VisualWorkshopCanvasPage(props: VisualWorkshopCanvasPageProps) {
  const [acceptance, setAcceptance] = useState(false);
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
  const openAcceptance = async () => {
    await controller.prepareCanvasForAgent();
    setAcceptance(true);
  };
  return (
    <>
      {acceptance && (
        <AcceptanceWorkspace
          key={props.projectId}
          projectId={props.projectId}
          title={controller.projectQuery.data?.title ?? "创作项目"}
          nodes={controller.nodes}
          prepareCanvas={controller.prepareCanvasForAgent}
          onBack={() => setAcceptance(false)}
        />
      )}
      <div style={{ display: acceptance ? "none" : undefined }}>
        {view === "board" ? (
          <ProjectBoard
            controller={controller}
            onAcceptance={() => {
              void openAcceptance();
            }}
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
                  ...(current.projectId === props.projectId
                    ? current.items
                    : {}),
                  [nodeId]: version,
                },
              }))
            }
          />
        ) : (
          <VisualWorkshopCanvasView
            controller={controller}
            onAcceptance={() => {
              void openAcceptance();
            }}
            onBoard={() => switchView("board")}
          />
        )}
      </div>
    </>
  );
}
