import type { BoardController } from "./boardTypes";
import type { VisualCanvasNode } from "../api";
import type { Card, CardKind } from "../creative/api";
import { CanvasNodeInspector } from "../canvas/CanvasNodeInspector";
import { InputReferences } from "./InputReferences";
import { TextWorkbench } from "./TextWorkbench";

/** Board-owned context and the shared node editor use explicit Canvas ports. */
export function BoardNodeEditor({
  controller: c,
  node,
  legacyKind,
  pending,
  onLegacyPick,
  onLegacyCreate,
  card,
  onCardHandled,
  generating,
}: {
  controller: BoardController;
  node: VisualCanvasNode;
  legacyKind?: CardKind;
  pending: boolean;
  onLegacyPick: () => void;
  onLegacyCreate: () => void;
  card?: Card;
  onCardHandled: () => void;
  generating: boolean;
}) {
  return (
    <>
      <div className="board-generation-context">
        {legacyKind && node.kind === "image" && (
          <div className="board-material-mode" aria-label="旧素材设定卡关联">
            <button type="button" disabled={pending} onClick={onLegacyPick}>
              {node.design_card_id ? "更换关联卡" : "关联已有卡"}
            </button>
            <button type="button" disabled={pending} onClick={onLegacyCreate}>
              用此图创建设定卡
            </button>
          </div>
        )}
        {node.kind !== "video" && (
          <InputReferences controller={c} nodeId={node.id} />
        )}
      </div>
      {node.kind === "text" ? (
        <TextWorkbench controller={c} node={node} />
      ) : (
        <CanvasNodeInspector
          referenceContext={{
            nodes: c.nodes,
            edges: c.edges,
            replaceEdges: c.replaceEdges,
            removeEdge: c.removeEdge,
          }}
          designReferenceRequest={
            card ? { card, handled: onCardHandled } : undefined
          }
          generating={generating}
          projectId={c.projectId}
          node={node}
          onClose={() => undefined}
          onPatch={(patch, immediate) => c.patchNode(node.id, patch, immediate)}
          onPrepareCanvas={c.prepareCanvasForAgent}
          onTaskLinked={(id) => c.linkGenerationTask(node.id, id)}
          onBatchCreated={async () => {
            await c.canvasQuery.refetch();
          }}
          embedded
          generationLayout="workbench"
        />
      )}
    </>
  );
}
