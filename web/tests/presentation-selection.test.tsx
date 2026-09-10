import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  newElement,
  defaultRun,
} from "@features/presentation-workshop/templates";
import {
  rotatedBounds,
  toolbarPosition,
  resizeFromHandle,
  resizeHandles,
} from "@features/presentation-workshop/selectionGeometry";
import { commonRunStyle } from "@features/presentation-workshop/useSelectionFormat";
import {
  SelectionToolbar,
  type SelectionActions,
} from "@features/presentation-workshop/SelectionToolbar";

it("places above with 12px gap, flips below and clamps to visible work area", () => {
  const area = { x: 200, y: 100, width: 800, height: 600 },
    size = { width: 400, height: 44 };
  expect(
    toolbarPosition({ x: 500, y: 300, width: 200, height: 100 }, area, size),
  ).toEqual({ x: 400, y: 244, placement: "top" });
  expect(
    toolbarPosition({ x: 200, y: 110, width: 100, height: 60 }, area, size),
  ).toEqual({ x: 208, y: 182, placement: "bottom" });
  expect(
    toolbarPosition({ x: 970, y: 600, width: 100, height: 60 }, area, size)?.x,
  ).toBe(592);
  expect(
    toolbarPosition({ x: 1000, y: 300, width: 100, height: 100 }, area, size),
  ).toBeNull();
});
it("computes rotated union rather than unrotated dimensions", () => {
  const a = newElement("rect", {
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 90,
  });
  expect(rotatedBounds([a])).toEqual({
    x: 150,
    y: 50,
    width: 100,
    height: 200,
  });
  expect(
    rotatedBounds([
      a,
      newElement("rect", { x: 400, y: 300, width: 100, height: 100 }),
    ]),
  ).toEqual({ x: 150, y: 50, width: 350, height: 350 });
});
it.each(resizeHandles)(
  "%s resize keeps the opposite anchor fixed in rotated space",
  (handle) => {
    const e = newElement("rect", {
      x: 120,
      y: 150,
      width: 200,
      height: 100,
      rotation: 30,
    });
    const next = resizeFromHandle(e, 30, 20, handle, false);
    const anchor = (el: typeof e) => {
      const x = handle.includes("w") ? 1 : handle.includes("e") ? -1 : 0;
      const y = handle.includes("n") ? 1 : handle.includes("s") ? -1 : 0;
      return {
        x:
          el.x +
          el.width / 2 +
          ((x * el.width) / 2) * Math.cos(Math.PI / 6) -
          ((y * el.height) / 2) * Math.sin(Math.PI / 6),
        y:
          el.y +
          el.height / 2 +
          ((x * el.width) / 2) * Math.sin(Math.PI / 6) +
          ((y * el.height) / 2) * Math.cos(Math.PI / 6),
      };
    };
    expect(anchor(next).x).toBeCloseTo(anchor(e).x);
    expect(anchor(next).y).toBeCloseTo(anchor(e).y);
  },
);
it.each(resizeHandles)("%s image resize preserves aspect ratio", (handle) => {
  const e = newElement("image", { width: 200, height: 100 });
  const next = resizeFromHandle(e, 25, 15, handle, false);
  expect(next.width / next.height).toBeCloseTo(2);
});
it("mixed formatting does not incorrectly report the first run", () => {
  const first = { ...defaultRun(), text: "a", size: 20, bold: true };
  expect(
    commonRunStyle([first, { ...first, text: "b", size: 34, bold: false }]),
  ).toMatchObject({ font: first.font });
  expect(commonRunStyle([first, { ...first, size: 34 }]).size).toBeUndefined();
});
it("toolbar changes controls by type and offers only unlock for a locked object", () => {
  const actions: SelectionActions = {
    patch: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(),
    arrange: vi.fn(),
    order: vi.fn(),
    inspect: vi.fn(),
  };
  const { rerender } = render(
    <SelectionToolbar
      elements={[newElement("text")]}
      editor={null}
      actions={actions}
      exit={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("字体")).toBeInTheDocument();
  rerender(
    <SelectionToolbar
      elements={[newElement("line")]}
      editor={null}
      actions={actions}
      exit={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("填充颜色")).not.toBeInTheDocument();
  expect(screen.getByLabelText("箭头设置")).toBeInTheDocument();
  rerender(
    <SelectionToolbar
      elements={[newElement("rect", { locked: true })]}
      editor={null}
      actions={actions}
      exit={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("描边颜色")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "解锁元素" }));
  expect(actions.patch).toHaveBeenCalledWith({ locked: false });
});

it("does not render selection editing UI on a read-only canvas", async () => {
  const { SlideCanvas } =
    await import("@features/presentation-workshop/SlideCanvas");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const element = newElement("text");
  try {
    const { container } = render(
      <SlideCanvas
        slide={{
          id: "slide",
          background: "#FFFFFF",
          notes: "",
          elements: [element],
        }}
        selected={[element.id]}
        select={vi.fn()}
        editing={null}
        setEditing={vi.fn()}
        replace={vi.fn()}
        onText={vi.fn()}
        readOnly
        zoom={1}
        onReady={vi.fn()}
        onComposition={vi.fn()}
        undo={vi.fn()}
        redo={vi.fn()}
        selectionToolbar={<div role="toolbar">编辑</div>}
      />,
    );
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(container.querySelector(".presentation-selection")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
