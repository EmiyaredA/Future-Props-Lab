import type { VisualWorkshopCanvasPageProps } from "@features/visual-workshop/canvas/visualCanvasTypes";
import { useVisualCanvasController } from "@features/visual-workshop/canvas/useVisualCanvasController";
import { VisualWorkshopCanvasView } from "@features/visual-workshop/canvas/VisualWorkshopCanvasView";
import { AcceptanceWorkspace } from "../acceptance/AcceptanceWorkspace";
import { useState } from "react";
import { ProjectBoard } from "@features/visual-workshop/board/ProjectBoard";
import { getNodeOutput, type VisualNodeOutput } from "../api";

export function VisualWorkshopCanvasPage(props: VisualWorkshopCanvasPageProps) {
  const [acceptance, setAcceptance] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState("");
  const [acceptanceEntry, setAcceptanceEntry] = useState<{
    nodeId: string;
    output?: VisualNodeOutput;
    entry: number;
  }>();
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
  const openAcceptance = async (output?: VisualNodeOutput) => {
    try {
      await controller.prepareCanvasForAgent();
      if (output) {
        controller.setSelectedId(output.node_id);
        switchView("board");
        setAcceptanceEntry({
          nodeId: output.node_id,
          output,
          entry: Date.now(),
        });
        setAcceptance(false);
        return;
      }
      setAcceptanceError("");
      setAcceptance(true);
    } catch (error) {
      setAcceptanceError(
        error instanceof Error ? error.message : "请先处理画布保存错误",
      );
    }
  };
  return (
    <>
      {acceptanceError && (
        <p role="alert" className="acceptance-error">
          {acceptanceError}
        </p>
      )}
      {acceptance && (
        <AcceptanceWorkspace
          key={props.projectId}
          projectId={props.projectId}
          title={controller.projectQuery.data?.title ?? "创作项目"}
          nodes={controller.nodes}
          onOpenNode={(nodeId, outputId) => {
            void (async () => {
              try {
                const output = outputId
                  ? await getNodeOutput(props.projectId, nodeId, outputId)
                  : undefined;
                controller.setSelectedId(nodeId);
                switchView("board");
                setHistoryPreviews((current) => ({
                  projectId: props.projectId,
                  items: {
                    ...(current.projectId === props.projectId
                      ? current.items
                      : {}),
                    [nodeId]: output,
                  },
                }));
                setAcceptanceEntry({ nodeId, output, entry: Date.now() });
                setAcceptance(false);
              } catch (error) {
                setAcceptanceError(
                  error instanceof Error ? error.message : "输出版本读取失败",
                );
              }
            })();
          }}
          onView={(next) => {
            switchView(next);
            setAcceptance(false);
          }}
          onConversation={() => {
            setAcceptance(false);
            controller.setAssistantOpen(true);
          }}
          onBack={() => setAcceptance(false)}
        />
      )}
      <div style={{ display: acceptance ? "none" : undefined }}>
        {view === "board" ? (
          <ProjectBoard
            controller={controller}
            acceptanceEntry={acceptanceEntry}
            onAcceptance={(output) => {
              void openAcceptance(output);
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
