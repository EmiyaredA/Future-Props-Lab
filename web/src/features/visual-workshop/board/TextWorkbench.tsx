import { LoadingScene } from "@shared/ui/LoadingScene";
import { useState } from "react";
import { Save } from "lucide-react";
import { saveNodeOutput, type VisualCanvasNode } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import type { BoardController } from "./boardTypes";

export function TextWorkbench({
  controller: c,
  node,
}: {
  controller: BoardController;
  node: Extract<VisualCanvasNode, { kind: "text" }>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setPending(true);
    setError("");
    try {
      const revision = await c.prepareCanvasForAgent();
      const current = c.nodesRef.current.find((item) => item.id === node.id);
      const updated = await saveNodeOutput(c.projectId, node.id, revision, {
        text: current?.kind === "text" ? current.text : node.text,
      });
      c.client.setQueryData(
        visualWorkshopQueryKeys.canvas(c.projectId),
        updated,
      );
      await c.client.invalidateQueries({
        queryKey: visualWorkshopQueryKeys.nodeOutputsProject(c.projectId),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="board-text-composer">
      <label className="board-text-editor">
        文本内容
        <textarea
          aria-label="文本内容"
          value={node.text}
          onChange={(event) =>
            c.patchNode(node.id, { text: event.target.value })
          }
          maxLength={20000}
          placeholder="编写脚本、角色描述或场景说明…"
        />
      </label>
      {error && (
        <p className="board-notice" role="alert">
          {error}
        </p>
      )}
      <footer>
        <small>{node.text?.length ?? 0} / 20000</small>
        <button
          className="board-primary"
          disabled={pending}
          onClick={() => void save()}
        >
          {pending ? <LoadingScene /> : <Save size={14} />}
          保存文本版本
        </button>
      </footer>
    </div>
  );
}
