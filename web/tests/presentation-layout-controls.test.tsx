import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PresentationInspector } from "@features/presentation-workshop/PresentationInspector";
import { SelectionToolbar } from "@features/presentation-workshop/SelectionToolbar";
import { SlideCanvas } from "@features/presentation-workshop/SlideCanvas";
import {
  applyLayout,
  layoutControls,
  type LayoutCommand,
} from "@features/presentation-workshop/layoutObjects";
import {
  newElement,
  newSlide,
} from "@features/presentation-workshop/templates";
import type { Slide } from "@features/presentation-workshop/types";

const noop = () => {};
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: noop,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
});

function fixture(): Slide {
  return {
    ...newSlide("blank"),
    elements: [
      newElement("rect", { id: "a", x: 100, y: 100, width: 100, height: 60 }),
      newElement("rect", { id: "b", x: 500, y: 100, width: 160, height: 80 }),
      newElement("rect", {
        id: "moving",
        x: 300,
        y: 300,
        width: 100,
        height: 60,
      }),
    ],
  };
}
function Controls({
  initial = fixture(),
  readOnly = false,
}: {
  initial?: Slide;
  readOnly?: boolean;
}) {
  const [slide, setSlide] = useState(initial);
  const selected = ["b", "a"];
  const layout = layoutControls(slide, selected, null, readOnly);
  const arrange = (mode: LayoutCommand) =>
    setSlide((s) => applyLayout(s, selected, null, mode));
  return (
    <>
      <SelectionToolbar
        elements={slide.elements.filter((e) => selected.includes(e.id))}
        layout={layout}
        editor={null}
        exit={noop}
        actions={{
          patch: noop,
          duplicate: noop,
          remove: noop,
          arrange,
          order: noop,
          inspect: noop,
        }}
      />
      <PresentationInspector
        slide={slide}
        selected={selected}
        layout={layout}
        arrange={arrange}
        patch={noop}
        background={noop}
        editor={null}
        order={noop}
        editText={noop}
        readOnly={readOnly}
      />
      <output aria-label="widths">
        {slide.elements.map((e) => e.width).join(",")}
      </output>
    </>
  );
}

it("both interfaces share the first-selected reference and commands", () => {
  render(<Controls />);
  const panel = screen.getByRole("complementary", { name: "格式面板" });
  expect(
    within(panel).getByText(/尺寸基准：形状 · 160 × 80/),
  ).toBeInTheDocument();
  expect(
    within(panel).getByRole("button", { name: "水平分布" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "对齐所选元素" }));
  expect(screen.getByRole("menuitem", { name: "水平分布" })).toBeDisabled();
  fireEvent.click(screen.getByRole("menuitem", { name: "统一宽度" }));
  expect(screen.getByLabelText("widths")).toHaveTextContent("160,160,100");
  fireEvent.click(within(panel).getByRole("button", { name: "统一高度" }));
  expect(within(panel).getByText(/160 × 80/)).toBeInTheDocument();
});

it("both interfaces explain media ratio conflicts and locks", () => {
  const initial = fixture();
  initial.elements[0].kind = "image";
  render(<Controls initial={initial} />);
  const panel = screen.getByRole("complementary");
  expect(
    within(panel).getByRole("button", { name: "统一宽高" }),
  ).toBeDisabled();
  expect(within(panel).getByText(/统一宽高会改变/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "对齐所选元素" }));
  expect(screen.getByRole("menuitem", { name: "统一宽高" })).toHaveAttribute(
    "title",
    expect.stringContaining("比例"),
  );
  expect(screen.getByRole("menuitem", { name: "统一宽度" })).toBeEnabled();
});

it.each(["locked", "readOnly"])(
  "disables commands for %s selections",
  (mode) => {
    const initial = fixture();
    initial.elements[0].locked = mode === "locked";
    render(<Controls initial={initial} readOnly={mode === "readOnly"} />);
    expect(screen.getByRole("button", { name: "统一宽度" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "对齐所选元素" }));
    expect(screen.getByRole("menuitem", { name: "左对齐" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "统一宽度" })).toBeDisabled();
  },
);

function canvas(replace = vi.fn()) {
  const initial = fixture();
  render(
    <SlideCanvas
      slide={initial}
      selected={["moving"]}
      select={noop}
      editing={null}
      setEditing={noop}
      replace={replace}
      onText={noop}
      readOnly={false}
      zoom={1}
      onReady={noop}
      onComposition={noop}
      undo={noop}
      redo={noop}
    />,
  );
  const host = screen.getByRole("group", { name: "幻灯片画布" });
  const object = document.querySelector('[data-element-id="moving"]')!;
  const drag = () => {
    fireEvent.pointerDown(object, {
      pointerId: 1,
      button: 0,
      clientX: 350,
      clientY: 330,
    });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 548, clientY: 330 });
  };
  return { host, object, drag, replace };
}

it("Alt clears guides immediately and commits the raw position once", () => {
  const { host, drag, replace } = canvas();
  drag();
  expect(
    document.querySelector('[data-guide-kind="align"]'),
  ).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Alt", altKey: true });
  expect(document.querySelector("[data-guide-kind]")).not.toBeInTheDocument();
  fireEvent.pointerUp(host, {
    pointerId: 1,
    clientX: 548,
    clientY: 330,
    altKey: true,
  });
  expect(replace).toHaveBeenCalledTimes(1);
  expect(
    replace.mock.calls[0][0].elements.find(
      (e: { id: string }) => e.id === "moving",
    ).x,
  ).toBe(498);
});

it.each(["escape", "pointerCancel", "lostCapture"])(
  "%s cancels previews without saving",
  (mode) => {
    const { host, drag, replace } = canvas();
    drag();
    if (mode === "escape") fireEvent.keyDown(host, { key: "Escape" });
    else if (mode === "pointerCancel")
      fireEvent.pointerCancel(host, { pointerId: 1 });
    else fireEvent.lostPointerCapture(host, { pointerId: 1 });
    expect(replace).not.toHaveBeenCalled();
    expect(document.querySelector("[data-guide-kind]")).not.toBeInTheDocument();
  },
);

it("returning a gesture to its start creates no edit", () => {
  const { host, drag, replace } = canvas();
  drag();
  fireEvent.pointerMove(host, {
    pointerId: 1,
    clientX: 350,
    clientY: 330,
    altKey: true,
  });
  fireEvent.pointerUp(host, {
    pointerId: 1,
    clientX: 350,
    clientY: 330,
    altKey: true,
  });
  expect(replace).not.toHaveBeenCalled();
});
