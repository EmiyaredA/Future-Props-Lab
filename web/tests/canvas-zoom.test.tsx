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

function dispatchShortcut(key: string, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

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
