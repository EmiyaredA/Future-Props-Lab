import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  VisualCanvasEdge,
  VisualCanvasNode,
} from "@features/visual-workshop/api";
import {
  captureCanvasSelection,
  cloneCanvasSelection,
  canvasPasteError,
  type CanvasClipboardSnapshot,
  type CanvasPoint,
} from "./canvasClipboard";

type ClipboardNotice = { tone: "success" | "error"; message: string };

export function useCanvasClipboard({
  projectId,
  nodesRef,
  edgesRef,
  conflictRef,
  selectedNodeIds,
  getPastePosition,
  commitSnapshot,
  selectPasted,
  closeContextMenu,
}: {
  projectId: string;
  nodesRef: RefObject<VisualCanvasNode[]>;
  edgesRef: RefObject<VisualCanvasEdge[]>;
  conflictRef: RefObject<boolean>;
  selectedNodeIds: string[];
  getPastePosition: () => CanvasPoint;
  commitSnapshot: (
    nodes: VisualCanvasNode[],
    edges: VisualCanvasEdge[],
  ) => void;
  selectPasted: (ids: string[]) => void;
  closeContextMenu: () => void;
}) {
  const clipboard = useRef<CanvasClipboardSnapshot | undefined>(undefined);
  const lastPaste = useRef<{ anchor: CanvasPoint; count: number } | undefined>(
    undefined,
  );
  const [canPaste, setCanPaste] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState<ClipboardNotice>();
  const resetPasteOffset = useCallback(() => {
    lastPaste.current = undefined;
  }, []);
  useEffect(() => {
    clipboard.current = undefined;
    lastPaste.current = undefined;
    setCanPaste(false);
    setClipboardNotice(undefined);
  }, [projectId]);
  useEffect(() => {
    if (clipboardNotice?.tone !== "success") return;
    const timer = window.setTimeout(() => setClipboardNotice(undefined), 3200);
    return () => window.clearTimeout(timer);
  }, [clipboardNotice]);

  const copyNodes = useCallback(
    (ids: string[]) => {
      const snapshot = captureCanvasSelection(
        nodesRef.current,
        edgesRef.current,
        ids,
      );
      if (!snapshot) return;
      clipboard.current = snapshot;
      lastPaste.current = undefined;
      setCanPaste(true);
      setClipboardNotice({
        tone: "success",
        message: `已复制 ${snapshot.nodes.length} 个节点`,
      });
      closeContextMenu();
    },
    [closeContextMenu, edgesRef, nodesRef],
  );
  const copySelected = useCallback(
    () => copyNodes(selectedNodeIds),
    [copyNodes, selectedNodeIds],
  );
  const pasteNodes = useCallback(
    (position?: CanvasPoint) => {
      if (!clipboard.current) return;
      if (conflictRef.current) {
        setClipboardNotice({
          tone: "error",
          message: "画布存在保存冲突，请先选择要使用的版本",
        });
        return;
      }
      const anchor = position ?? getPastePosition();
      const previous = lastPaste.current;
      const count =
        previous &&
        previous.anchor.x === anchor.x &&
        previous.anchor.y === anchor.y
          ? previous.count + 1
          : 0;
      const added = cloneCanvasSelection(clipboard.current, {
        x: anchor.x + count * 32,
        y: anchor.y + count * 32,
      });
      const error = canvasPasteError(
        { nodes: nodesRef.current, edges: edgesRef.current },
        added,
      );
      if (error) {
        setClipboardNotice({ tone: "error", message: error });
        return;
      }
      commitSnapshot(
        [...nodesRef.current, ...added.nodes],
        [...edgesRef.current, ...added.edges],
      );
      lastPaste.current = { anchor, count };
      selectPasted(added.nodes.map((node) => node.id));
      closeContextMenu();
      setClipboardNotice({
        tone: "success",
        message: `已粘贴 ${added.nodes.length} 个节点`,
      });
    },
    [
      closeContextMenu,
      commitSnapshot,
      conflictRef,
      edgesRef,
      getPastePosition,
      nodesRef,
      selectPasted,
    ],
  );
  return {
    canPaste,
    clipboardNotice,
    copyNodes,
    copySelected,
    pasteNodes,
    resetPasteOffset,
  };
}
