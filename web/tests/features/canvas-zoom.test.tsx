import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";
import { useCanvasKeyboardShortcuts } from "@features/visual-workshop/canvas/useCanvasKeyboardShortcuts";
import { zoomViewportAt } from "@features/visual-workshop/canvas/useVisualCanvasController";

function ShortcutHarness() {
  const [zoom, setZoom] = useState(1);
  useCanvasKeyboardShortcuts({
    selectedNodeIds: [],
    selectedEdgeId: undefined,
    clearContextMenu: vi.fn(),
    clearNodeSelection: vi.fn(),
    clearEdgeSelection: vi.fn(),
    selectAllNodes: vi.fn(),
    copySelected: vi.fn(),
    pasteAtPointer: vi.fn(),
    removeNodes: vi.fn(),
    removeEdge: vi.fn(),
    setToolMode: vi.fn(),
    fitView: vi.fn(),
    zoomIn: () => setZoom((current) => current + 0.1),
    zoomOut: () => setZoom((current) => current - 0.1),
    resetZoom: () => setZoom(1),
    nudgeSelected: vi.fn(),
  });
  return (
    <>
      <output aria-label="缩放值">{Math.round(zoom * 100)}%</output>
      <div role="dialog" aria-modal="true">
        <button>弹窗按钮</button>
      </div>
    </>
  );
}

function HistoryShortcutHarness({
  undo,
  redo,
}: {
  undo: () => boolean;
  redo: () => boolean;
}) {
  useCanvasKeyboardShortcuts({
    selectedNodeIds: [],
    selectedEdgeId: undefined,
    clearContextMenu: vi.fn(),
    clearNodeSelection: vi.fn(),
    clearEdgeSelection: vi.fn(),
    selectAllNodes: vi.fn(),
    copySelected: vi.fn(),
    pasteAtPointer: vi.fn(),
    removeNodes: vi.fn(),
    removeEdge: vi.fn(),
    setToolMode: vi.fn(),
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    nudgeSelected: vi.fn(),
    undo,
    redo,
  });
  return (
    <>
      <input aria-label="编辑框" />
      <div
        aria-label="画布提示词"
        contentEditable
        data-canvas-history-shortcuts="true"
      />
      <div role="dialog" aria-modal="true">
        <button>弹窗按钮</button>
      </div>
    </>
  );
}

function dispatchShortcut(
  key: string,
  target: EventTarget = window,
  options: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

test("routes canvas undo and redo shortcuts while preserving editor and modal input", () => {
  const undo = vi.fn(() => true);
  const redo = vi.fn(() => true);
  render(<HistoryShortcutHarness undo={undo} redo={redo} />);

  expect(
    dispatchShortcut("z", window, { ctrlKey: true }).defaultPrevented,
  ).toBe(true);
  expect(undo).toHaveBeenCalledTimes(1);
  expect(
    dispatchShortcut("z", window, { ctrlKey: true, shiftKey: true }),
  ).toHaveProperty("defaultPrevented", true);
  expect(redo).toHaveBeenCalledTimes(1);
  dispatchShortcut("y", window, { ctrlKey: true });
  expect(redo).toHaveBeenCalledTimes(2);

  const input = screen.getByLabelText("编辑框");
  const inputShortcut = dispatchShortcut("z", input, { ctrlKey: true });
  expect(inputShortcut.defaultPrevented).toBe(false);
  expect(undo).toHaveBeenCalledTimes(1);

  const prompt = screen.getByLabelText("画布提示词");
  expect(
    dispatchShortcut("z", prompt, { ctrlKey: true }).defaultPrevented,
  ).toBe(true);
  expect(undo).toHaveBeenCalledTimes(2);
  dispatchShortcut("y", prompt, { ctrlKey: true });
  expect(redo).toHaveBeenCalledTimes(3);

  const modalShortcut = dispatchShortcut(
    "z",
    screen.getByRole("button", { name: "弹窗按钮" }),
    { ctrlKey: true },
  );
  expect(modalShortcut.defaultPrevented).toBe(false);
  expect(undo).toHaveBeenCalledTimes(2);
});

test("keeps the zoom anchor world position stable", () => {
  const zoomed = zoomViewportAt({ x: 100, y: 50, zoom: 1 }, 2, 400, 300);
  expect(zoomed).toEqual({ x: -200, y: -200, zoom: 2 });
  expect(zoomViewportAt(zoomed, 1, 400, 300)).toEqual({
    x: 100,
    y: 50,
    zoom: 1,
  });
});

test("routes command zoom shortcuts to the canvas but leaves modal portals alone", () => {
  render(<ShortcutHarness />);

  expect(dispatchShortcut("+").defaultPrevented).toBe(true);
  expect(screen.getByLabelText("缩放值")).toHaveTextContent("110%");
  expect(dispatchShortcut("-").defaultPrevented).toBe(true);
  expect(screen.getByLabelText("缩放值")).toHaveTextContent("100%");
  expect(dispatchShortcut("+").defaultPrevented).toBe(true);
  expect(dispatchShortcut("0").defaultPrevented).toBe(true);
  expect(screen.getByLabelText("缩放值")).toHaveTextContent("100%");

  const modalShortcut = dispatchShortcut(
    "+",
    screen.getByRole("button", { name: "弹窗按钮" }),
  );
  expect(modalShortcut.defaultPrevented).toBe(false);
  expect(screen.getByLabelText("缩放值")).toHaveTextContent("100%");
});
