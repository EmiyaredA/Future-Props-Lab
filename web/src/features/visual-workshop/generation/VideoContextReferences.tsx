import { useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Link2 } from "lucide-react";
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
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            type="button"
            className="reference-add"
            aria-label="添加参考素材"
          >
            <Link2 size={14} aria-hidden />
            引用
            <ChevronDown size={12} aria-hidden />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="reference-menu" sideOffset={5}>
            <Menu.Item onSelect={() => setDialog({})}>引用任务输出</Menu.Item>
            {c.referenceInputs.length > 0 && <Menu.Separator />}
            {c.referenceInputs.map((input) => (
              <Menu.Item
                key={input.key}
                onSelect={() => setDialog({ edge: input.edge })}
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
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {dialog && (
        <TaskOutputReferenceDialog
          projectId={c.projectId}
          nodeId={c.canvasNodeId}
          context={c.referenceContext}
          edge={dialog.edge}
          onClose={() => setDialog(undefined)}
        />
      )}
    </>
  );
}
