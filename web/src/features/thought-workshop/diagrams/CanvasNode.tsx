import { useDocumentAccess } from "../DocumentAccess";
import { lazy, Suspense, useState } from "react";
import { Node } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { emptyScene, parseCanvasScene } from "./model";
import { CanvasSvg } from "./CanvasSvg";
import { canvasSvgText } from "./export";
import { DiagramViewer } from "./DiagramViewer";
const CanvasEditor = lazy(() =>
  import("./CanvasEditor").then((m) => ({ default: m.CanvasEditor })),
);
function CanvasView({ node, getPos, editor }: NodeViewProps) {
  const access = useDocumentAccess();
  const [editing, setEditing] = useState(false);
  let scene;
  try {
    scene = parseCanvasScene(node.attrs.scene);
  } catch {
    return (
      <NodeViewWrapper contentEditable={false}>
        <p role="alert">画板数据无法读取，请检查版本或恢复历史。</p>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper contentEditable={false} className="thought-canvas">
      <DiagramViewer
        title={scene.title || "信息图"}
        svg={() => canvasSvgText(scene, access.assetUrl)}
        onEdit={editor.isEditable ? () => setEditing(true) : undefined}
      >
        <CanvasSvg scene={scene} />
      </DiagramViewer>
      {editing && editor.isEditable && (
        <Suspense fallback={<p role="status">正在加载画板…</p>}>
          <CanvasEditor
            scene={scene}
            onChange={(value) => {
              const position = getPos();
              if (position === undefined || !editor.isEditable) return;
              const current = editor.state.doc.nodeAt(position);
              if (current?.type.name !== "canvas") return;
              editor.view.dispatch(
                closeHistory(editor.state.tr).setNodeMarkup(
                  position,
                  undefined,
                  { ...current.attrs, scene: value },
                ),
              );
            }}
            onClose={() => setEditing(false)}
            onUndo={() => editor.commands.undo()}
            onRedo={() => editor.commands.redo()}
          />
        </Suspense>
      )}
    </NodeViewWrapper>
  );
}
export const CanvasNode = Node.create({
  name: "canvas",
  priority: 1000,
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { scene: { default: emptyScene() } };
  },
  parseHTML() {
    return [
      {
        tag: "pre[data-fpl-canvas]",
        getAttrs: (e) => {
          try {
            return { scene: parseCanvasScene(JSON.parse(e.textContent || "")) };
          } catch {
            return false;
          }
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "pre",
      { "data-fpl-canvas": "true" },
      JSON.stringify(node.attrs.scene),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CanvasView);
  },
});
