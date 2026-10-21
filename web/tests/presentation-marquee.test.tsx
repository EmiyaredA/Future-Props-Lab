import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideCanvas } from "@features/presentation-workshop/SlideCanvas";
import { marqueeSelection } from "@features/presentation-workshop/scene/selection";
import {
  newElement,
  newSlide,
} from "@features/presentation-workshop/templates";
import type { Slide } from "@features/presentation-workshop/types";

vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: "", loading: false, error: null }),
}));
vi.mock("@features/presentation-workshop/SlideTextEditor", () => ({
  SlideTextEditor: () => (
    <textarea className="presentation-text-editor" aria-label="编辑文字" />
  ),
}));
const replace = vi.fn();
function fixture(): Slide {
  return {
    ...newSlide(),
    elements: [
      newElement("rect", {
        id: "background",
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        locked: true,
      }),
      newElement("rect", { id: "a", x: 100, y: 100, width: 100, height: 100 }),
      newElement("text", { id: "b", x: 300, y: 100, width: 100, height: 100 }),
      newElement("image", {
        id: "hidden",
        x: 120,
        y: 120,
        width: 50,
        height: 50,
        hidden: true,
      }),
      newElement("rect", { id: "c", x: 700, y: 400, width: 100, height: 100 }),
    ],
  };
}
function Harness({
  initial = fixture(),
  readOnly = false,
  zoom = 1,
  initialScope = null,
}: {
  initial?: Slide;
  readOnly?: boolean;
  zoom?: number;
  initialScope?: string | null;
}) {
  const [slide] = useState(initial);
  const [selected, select] = useState<string[]>(["c"]);
  const [scope, setScope] = useState(initialScope);
  const [boxSelect, setBoxSelect] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const history = useRef<(() => boolean) | null>(null);
  return (
    <>
      <button onClick={() => setBoxSelect((v) => !v)}>框选工具</button>
      <button onClick={() => history.current?.()}>取消手势</button>
      <output aria-label="选择">{selected.join(",")}</output>
      <output aria-label="作用域">{scope ?? "page"}</output>
      <output aria-label="工具">{String(boxSelect)}</output>
      <SlideCanvas
        slide={slide}
        selected={selected}
        select={select}
        editing={editing}
        setEditing={setEditing}
        replace={replace}
        onText={vi.fn()}
        readOnly={readOnly}
        zoom={zoom}
        onReady={vi.fn()}
        onComposition={vi.fn()}
        boxSelect={boxSelect}
        onBoxSelectEnd={() => setBoxSelect(false)}
        historyGesture={history}
        groupScope={scope}
        onGroupScopeChange={(next, ids) => {
          setScope(next);
          select(ids);
        }}
      />
    </>
  );
}
const chosen = () =>
  screen.getByLabelText("选择").textContent!.split(",").filter(Boolean);
const canvas = () => screen.getByRole("group", { name: "幻灯片画布" });
function drag(
  from: Element,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  modifiers = {},
) {
  fireEvent.pointerDown(from, {
    button: 0,
    pointerId: 1,
    clientX: x1,
    clientY: y1,
    ...modifiers,
  });
  fireEvent.pointerMove(canvas(), {
    pointerId: 1,
    clientX: x2,
    clientY: y2,
    ...modifiers,
  });
}
function up(x: number, y: number, modifiers = {}) {
  fireEvent.pointerUp(canvas(), {
    pointerId: 1,
    clientX: x,
    clientY: y,
    ...modifiers,
  });
}
beforeEach(() => {
  replace.mockClear();
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
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
});
afterEach(() => {
  for (const name of [
    "setPointerCapture",
    "hasPointerCapture",
    "releasePointerCapture",
  ])
    Reflect.deleteProperty(HTMLElement.prototype, name);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("逻辑对象框选", () => {
  it("按文稿顺序选完整对象，跳过隐藏与锁定，旋转后按实际外界判断", () => {
    const s = fixture();
    expect(
      marqueeSelection(s, { x: 90, y: 90, width: 320, height: 120 }),
    ).toEqual(["a", "b"]);
    s.elements[1].rotation = 45;
    expect(
      marqueeSelection(s, { x: 100, y: 100, width: 100, height: 100 }),
    ).toEqual([]);
    expect(
      marqueeSelection(s, { x: 70, y: 70, width: 160, height: 160 }),
    ).toEqual(["a"]);
  });
  it("分组完整包围才选中，组内框选不扩展到组外", () => {
    const s = fixture();
    s.groups = [
      { id: "root", name: "外层", element_ids: ["c"] },
      { id: "child", name: "内层", parent_id: "root", element_ids: ["a", "b"] },
    ];
    expect(
      marqueeSelection(s, { x: 90, y: 90, width: 320, height: 120 }),
    ).toEqual([]);
    expect(
      marqueeSelection(s, { x: 90, y: 90, width: 720, height: 420 }),
    ).toEqual(["a", "b", "c"]);
    expect(
      marqueeSelection(s, { x: 90, y: 90, width: 120, height: 120 }, "child"),
    ).toEqual(["a"]);
    s.elements[2].locked = true;
    expect(
      marqueeSelection(s, { x: 0, y: 0, width: 1280, height: 720 }),
    ).toEqual([]);
  });
});

describe("画布框选手势", () => {
  it("页外留白发起，在缩放坐标中框选，不写入文稿；反向拉框同样可用", () => {
    const s = fixture();
    s.elements = s.elements.filter((e) => e.id !== "background");
    render(<Harness initial={s} zoom={0.5} />);
    const host = document.querySelector<HTMLElement>(
      ".presentation-canvas-area",
    )!;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      width: 1000,
      height: 700,
    } as DOMRect);
    Object.defineProperties(host, {
      clientWidth: { value: 1000 },
      clientHeight: { value: 700 },
    });
    vi.spyOn(canvas(), "getBoundingClientRect").mockReturnValue({
      left: 200,
      top: 180,
      width: 640,
      height: 360,
    } as DOMRect);
    drag(host, 190, 170, 410, 290);
    expect(chosen()).toEqual(["a", "b"]);
    expect(document.querySelector(".presentation-marquee")).toHaveStyle({
      left: "-20px",
      top: "-20px",
      width: "440px",
      height: "240px",
    });
    up(410, 290);
    expect(replace).not.toHaveBeenCalled();
    drag(canvas(), 410, 290, 240, 220);
    up(240, 220);
    expect(chosen()).toEqual(["a", "b"]);
  });
  it.each(["shiftKey", "metaKey", "ctrlKey"])(
    "%s 追加框选保留原有选区",
    (modifier) => {
      render(<Harness />);
      fireEvent.click(screen.getByText("框选工具"));
      drag(screen.getByLabelText("框选区域"), 90, 90, 410, 210, {
        [modifier]: true,
      });
      up(410, 210, { [modifier]: true });
      expect(chosen()).toEqual(["c", "a", "b"]);
      expect(screen.getByLabelText("工具")).toHaveTextContent("false");
    },
  );
  it("框选工具能从背景上的任意位置启动，松手后可恢复普通选择", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("框选工具"));
    drag(screen.getByLabelText("框选区域"), 90, 90, 410, 210);
    up(410, 210);
    expect(chosen()).toEqual(["a", "b"]);
    expect(screen.queryByLabelText("框选区域")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
  it.each(["Escape", "pointercancel", "lostpointercapture", "blur", "history"])(
    "%s 取消框选并恢复旧选择",
    (how) => {
      render(<Harness />);
      fireEvent.click(screen.getByText("框选工具"));
      drag(screen.getByLabelText("框选区域"), 90, 90, 410, 210);
      expect(chosen()).toEqual(["a", "b"]);
      if (how === "Escape") fireEvent.keyDown(canvas(), { key: "Escape" });
      else if (how === "pointercancel")
        fireEvent.pointerCancel(canvas(), { pointerId: 1 });
      else if (how === "lostpointercapture")
        fireEvent.lostPointerCapture(canvas(), { pointerId: 1 });
      else if (how === "blur") fireEvent(window, new Event("blur"));
      else fireEvent.click(screen.getByText("取消手势"));
      expect(chosen()).toEqual(["c"]);
      expect(document.querySelector(".presentation-marquee")).toBeNull();
      up(410, 210);
      expect(replace).not.toHaveBeenCalled();
    },
  );
  it("组内显式框选保持作用域，只读不启动手势", () => {
    const s = fixture();
    s.groups = [{ id: "root", name: "组", element_ids: ["a", "b"] }];
    const view = render(<Harness initial={s} initialScope="root" />);
    fireEvent.click(screen.getByText("框选工具"));
    drag(screen.getByLabelText("框选区域"), 90, 90, 210, 210);
    up(210, 210);
    expect(chosen()).toEqual(["a"]);
    expect(screen.getByLabelText("作用域")).toHaveTextContent("root");
    view.rerender(<Harness initial={s} readOnly />);
    drag(canvas(), 0, 0, 410, 210);
    up(410, 210);
    expect(document.querySelector(".presentation-marquee")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
