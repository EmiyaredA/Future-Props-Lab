import { useEffect } from "react";
import type { CanvasTool } from "@features/visual-workshop/canvas/useCanvasPointerInteractions";

type CanvasKeyboardShortcutOptions = {
  selectedNodeIds: string[];
  selectedEdgeId: string | undefined;
  clearContextMenu: () => void;
  clearNodeSelection: () => void;
  clearEdgeSelection: () => void;
  selectAllNodes: () => void;
  copySelected: () => void;
  pasteAtPointer: () => void;
  removeNodes: (ids: string[]) => void;
  removeEdge: (id: string) => void;
  setToolMode: (tool: CanvasTool) => void;
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  nudgeSelected: (x: number, y: number) => void;
  undo?: () => boolean;
  redo?: () => boolean;
};

export function useCanvasKeyboardShortcuts({
  selectedNodeIds,
  selectedEdgeId,
  clearContextMenu,
  clearNodeSelection,
  clearEdgeSelection,
  selectAllNodes,
  copySelected,
  pasteAtPointer,
  removeNodes,
  removeEdge,
  setToolMode,
  fitView,
  zoomIn,
  zoomOut,
  resetZoom,
  nudgeSelected,
  undo = () => false,
  redo = () => false,
}: CanvasKeyboardShortcutOptions) {
  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const editing =
        event.target instanceof Element &&
        event.target.matches(
          "input, textarea, select, [contenteditable='true']",
        );
      if (event.key === "Escape") {
        clearContextMenu();
        clearNodeSelection();
        clearEdgeSelection();
        return;
      }
      const shortcut = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      const insideModal =
        event.target instanceof Element &&
        Boolean(event.target.closest('[role="dialog"][aria-modal="true"]'));
      if (modifier && !insideModal && ["+", "=", "-", "0"].includes(shortcut)) {
        event.preventDefault();
        if (shortcut === "-") zoomOut();
        else if (shortcut === "0") resetZoom();
        else zoomIn();
        return;
      }
      if (editing || insideModal) return;
      if (modifier && shortcut === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && shortcut === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && shortcut === "a") {
        event.preventDefault();
        selectAllNodes();
        clearEdgeSelection();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && shortcut === "c") {
        event.preventDefault();
        copySelected();
      }
      if ((event.metaKey || event.ctrlKey) && shortcut === "v") {
        event.preventDefault();
        pasteAtPointer();
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedNodeIds.length
      ) {
        event.preventDefault();
        removeNodes(selectedNodeIds);
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedEdgeId
      ) {
        event.preventDefault();
        removeEdge(selectedEdgeId);
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (shortcut === "v") setToolMode("select");
      else if (shortcut === "h") setToolMode("pan");
      else if (shortcut === "f") fitView();
      else if (event.key.startsWith("Arrow") && selectedNodeIds.length) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        nudgeSelected(
          event.key === "ArrowLeft"
            ? -amount
            : event.key === "ArrowRight"
              ? amount
              : 0,
          event.key === "ArrowUp"
            ? -amount
            : event.key === "ArrowDown"
              ? amount
              : 0,
        );
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [
    clearContextMenu,
    clearEdgeSelection,
    clearNodeSelection,
    copySelected,
    fitView,
    nudgeSelected,
    pasteAtPointer,
    removeEdge,
    removeNodes,
    resetZoom,
    selectAllNodes,
    selectedEdgeId,
    selectedNodeIds,
    setToolMode,
    zoomIn,
    zoomOut,
    redo,
    undo,
  ]);
}
