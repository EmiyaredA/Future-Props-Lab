import { useState } from "react";
import { TaskOutputReferenceDialog } from "./TaskOutputReferenceDialog";
import type { useGenerationDrawerController } from "./useGenerationDrawerController";
import type { VisualCanvasEdge } from "../api";

/** Non-reference modes still need their textual context and pending-input controls. */
export function VideoContextReferences({
  controller: c,
}: {
  controller: ReturnType<typeof useGenerationDrawerController>;
}) {
  const [dialog, setDialog] = useState<{ edge?: VisualCanvasEdge }>();
  if (!c.referenceContext || !c.canvasNodeId) return null;
  return (
    <div className="video-context-references">
      {c.referenceInputs.length > 0 && (
        <details>
          <summary>上下文与输入 {c.referenceInputs.length}</summary>
          <div>
            {c.referenceInputs.map((input) => (
              <button
                type="button"
                key={input.key}
                onClick={() => setDialog({ edge: input.edge })}
              >
                <span>{input.title}</span>
                <small>
                  {input.loading
                    ? "读取中…"
                    : (input.error ??
                      (input.kind === "text"
                        ? "文本上下文"
                        : `v${input.version ?? "—"}`))}
                </small>
              </button>
            ))}
          </div>
        </details>
      )}
      <button type="button" onClick={() => setDialog({})}>
        引用任务输出
      </button>
      {dialog && (
        <TaskOutputReferenceDialog
          projectId={c.projectId}
          nodeId={c.canvasNodeId}
          context={c.referenceContext}
          edge={dialog.edge}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}
