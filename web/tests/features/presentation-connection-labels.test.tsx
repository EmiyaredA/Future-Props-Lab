import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useRef, useState, type PointerEvent } from "react";
import { describe, it, expect, vi } from "vitest";
import vectors from "../../../tests/fixtures/presentation_connection_labels.json";
import {
  labelLayout,
  positionLabel,
  resizeLabel,
} from "@features/presentation-workshop/scene/connectionLabelLayout";
import {
  connectionPoints,
  translateConnection,
} from "@features/presentation-workshop/scene/connectionGeometry";
import { newConnection } from "@features/presentation-workshop/scene/connectionEditing";
import {
  newElement,
  newSlide,
} from "@features/presentation-workshop/templates";
import { useConnectionLabels } from "@features/presentation-workshop/scene/useConnectionLabels";
import { SlideSurface } from "@features/presentation-workshop/SlideSurface";
import { usePresentationDraft } from "@features/presentation-workshop/usePresentationDraft";
import type { Project } from "@features/presentation-workshop/types";
import { ConnectionLabels } from "@features/presentation-workshop/scene/ConnectionLabels";
import { ConnectionPanel } from "@features/presentation-workshop/scene/ConnectionPanel";

vi.mock("@features/presentation-workshop/api", () => ({
  saveProject: vi.fn(),
  createProject: vi.fn(),
}));

function fixture() {
  const slide = newSlide();
  slide.elements = [
    newElement("rect", { id: "a", x: 100, y: 100, width: 100, height: 100 }),
    newElement("rect", { id: "b", x: 600, y: 300, width: 100, height: 100 }),
  ];
  const edge = { ...newConnection(slide, ["a", "b"]), label: "每轮读取" };
  slide.connections = [edge];
  return { slide, edge };
}

describe("connector label layout", () => {
  it.each(vectors)("matches backend: $name", (vector) => {
    expect(
      labelLayout(vector.points, {
        label: vector.label,
        label_position: vector.position,
        label_offset: vector.offset,
        label_font_size: vector.font_size,
      }),
    ).toEqual(vector.expected);
  });
  it("follows moved nodes and translated free routes with unchanged label offsets", () => {
    const { slide, edge } = fixture();
    const before = labelLayout(connectionPoints(slide, edge), edge)!;
    const moved = {
      ...slide,
      elements: slide.elements.map((e) => ({ ...e, x: e.x + 70, y: e.y + 30 })),
    };
    const after = labelLayout(connectionPoints(moved, edge), edge)!;
    expect(after.x - before.x).toBe(70);
    expect(after.y - before.y).toBe(30);
    const free = translateConnection(slide, edge, { x: 40, y: -20 });
    const translated = labelLayout(connectionPoints(slide, free), free)!;
    expect(translated.x - before.x).toBe(40);
    expect(translated.y - before.y).toBe(-20);
  });
  it("projects onto an explicit path while retaining the dragged centre", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const patch = positionLabel(points, { x: 120, y: 60 });
    const box = labelLayout(points, { label: "提交", ...patch })!;
    expect(box.x + box.width / 2).toBe(120);
    expect(box.y + box.height / 2).toBe(60);
    expect(patch.label_position).toBe(0.8);
  });
  it.each(["每轮读取", "允许下一轮读取更新后的消息并继续执行工具调用"])(
    "resizes with the top-left fixed, including text reflow: %s",
    (label) => {
      const { slide, edge } = fixture();
      edge.label = label;
      const points = connectionPoints(slide, edge);
      const before = labelLayout(points, edge)!;
      const patch = resizeLabel(points, edge, { x: 80, y: 35 })!;
      const after = labelLayout(points, { ...edge, ...patch })!;
      expect(patch.label_font_size).toBeGreaterThan(16);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
      expect(patch).not.toHaveProperty("waypoints");
      expect(patch).not.toHaveProperty("source_id");
      expect(
        resizeLabel(points, edge, { x: -10000, y: -10000 })!.label_font_size,
      ).toBe(6);
      expect(
        resizeLabel(points, edge, { x: 10000, y: 10000 })!.label_font_size,
      ).toBe(72);
    },
  );
});

function setup() {
  const { slide, edge } = fixture(),
    element = document.createElement("div"),
    target = document.createElementNS("http://www.w3.org/2000/svg", "g");
  target.focus = vi.fn();
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1280, height: 720 }) as DOMRect;
  element.setPointerCapture = vi.fn();
  element.releasePointerCapture = vi.fn();
  element.hasPointerCapture = () => true;
  const commit = vi.fn(),
    composition = vi.fn();
  const hook = renderHook(
    (props) =>
      useConnectionLabels({
        ...props,
        canvas: { current: element },
        scale: 0.5,
        commit,
        onComposition: composition,
      }),
    { initialProps: { slide, selected: edge.id, readOnly: false } },
  );
  const event = (x: number, y: number) =>
    ({
      pointerId: 1,
      button: 0,
      clientX: x,
      clientY: y,
      currentTarget: target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }) as unknown as PointerEvent<SVGGElement>;
  const start = () =>
    act(() =>
      hook.result.current.actions.onLabelPointerDown(event(200, 120), edge),
    );
  return { ...hook, slide, edge, element, commit, event, start };
}

describe("connector label gestures", () => {
  it("resizes at the viewport scale and commits one label-only history step", () => {
    const h = setup();
    const before = labelLayout(connectionPoints(h.slide, h.edge), h.edge)!;
    act(() =>
      h.result.current.actions.onLabelResizePointerDown(
        h.event(200, 120),
        h.edge,
      ),
    );
    act(() => h.result.current.move(h.event(220, 130)));
    expect(h.commit).not.toHaveBeenCalled();
    const preview = h.result.current.preview!;
    expect(preview.label_font_size).toBe(
      resizeLabel(connectionPoints(h.slide, h.edge), h.edge, { x: 40, y: 20 })!
        .label_font_size,
    );
    const after = labelLayout(connectionPoints(h.slide, preview), preview)!;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(preview.source_id).toBe(h.edge.source_id);
    expect(preview.target_id).toBe(h.edge.target_id);
    expect(preview.waypoints).toEqual(h.edge.waypoints);
    act(() => h.result.current.finish(h.event(220, 130)));
    act(() => h.result.current.finish(h.event(220, 130)));
    expect(h.commit).toHaveBeenCalledOnce();
  });
  it("cancels a resize and prevents a read-only resize", () => {
    const h = setup();
    act(() =>
      h.result.current.actions.onLabelResizePointerDown(
        h.event(200, 120),
        h.edge,
      ),
    );
    act(() => h.result.current.move(h.event(220, 130)));
    act(() => h.result.current.cancel());
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.result.current.preview).toBeNull();
    h.rerender({ slide: h.slide, selected: h.edge.id, readOnly: true });
    act(() =>
      h.result.current.actions.onLabelResizePointerDown(
        h.event(200, 120),
        h.edge,
      ),
    );
    expect(h.result.current.active()).toBe(false);
  });
  it("previews only the label, respects zoom and commits once", () => {
    const h = setup();
    h.start();
    act(() => h.result.current.move(h.event(220, 130)));
    expect(h.commit).not.toHaveBeenCalled();
    const preview = h.result.current.preview!;
    expect(preview.source_id).toBe(h.edge.source_id);
    expect(preview.waypoints).toEqual(h.edge.waypoints);
    const before = labelLayout(connectionPoints(h.slide, h.edge), h.edge)!;
    const after = labelLayout(connectionPoints(h.slide, preview), preview)!;
    expect(after.x - before.x).toBe(40);
    expect(after.y - before.y).toBe(20);
    act(() => h.result.current.finish(h.event(220, 130)));
    act(() => h.result.current.finish(h.event(220, 130)));
    expect(h.commit).toHaveBeenCalledOnce();
  });
  it.each(["page", "document", "selection", "readOnly", "cancel", "blur"])(
    "cancels without saving: %s",
    (reason) => {
      const h = setup();
      h.start();
      act(() => h.result.current.move(h.event(220, 130)));
      if (reason === "cancel") act(() => h.result.current.cancel());
      else if (reason === "blur")
        act(() => window.dispatchEvent(new Event("blur")));
      else
        h.rerender({
          slide:
            reason === "page"
              ? { ...h.slide, id: "next" }
              : reason === "document"
                ? { ...h.slide }
                : h.slide,
          selected: reason === "selection" ? "other" : h.edge.id,
          readOnly: reason === "readOnly",
        });
      expect(h.result.current.active()).toBe(false);
      expect(h.commit).not.toHaveBeenCalled();
      expect(h.result.current.preview).toBeNull();
    },
  );
});

function EditorHarness({ readOnly = false }: { readOnly?: boolean }) {
  const [initial] = useState(() => {
    const { slide } = fixture();
    return {
      id: "test",
      title: "labels",
      revision: 0,
      created_at: "",
      updated_at: "",
      document: { version: 3, width: 1280, height: 720, slides: [slide] },
    } as Project;
  });
  const draft = usePresentationDraft(initial, vi.fn()),
    slide = draft.draft.document.slides[0],
    edge = slide.connections![0];
  const canvas = useRef<HTMLDivElement>(null);
  const labels = useConnectionLabels({
    slide,
    selected: edge.id,
    readOnly,
    canvas,
    scale: 1,
    onComposition: draft.setComposition,
    commit: (s) =>
      draft.commit((d) => ({ ...d, document: { ...d.document, slides: [s] } })),
  });
  return (
    <div ref={canvas}>
      <button onClick={() => labels.actions.onEditLabel(edge)}>编辑</button>
      <button onClick={draft.undo}>撤销</button>
      <button onClick={draft.redo}>重做</button>
      <output aria-label="当前文字">{edge.label}</output>
      <output aria-label="当前字号">{edge.label_font_size ?? 16}</output>
      <SlideSurface
        slide={slide}
        selectedConnection={edge.id}
        onSelectConnection={readOnly ? undefined : () => {}}
        connectionLabelActions={readOnly ? undefined : labels.actions}
      >
        {labels.editor}
      </SlideSurface>
    </div>
  );
}

describe("inline label editing", () => {
  it("makes the resize handle keyboard-accessible with undo and redo", () => {
    render(<EditorHarness />);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: "连线文字大小：每轮读取" }),
      { key: "ArrowRight" },
    );
    expect(screen.getByLabelText("当前字号")).toHaveTextContent("16.5");
    fireEvent.click(screen.getByText("撤销"));
    expect(screen.getByLabelText("当前字号")).toHaveTextContent("16");
    fireEvent.click(screen.getByText("重做"));
    expect(screen.getByLabelText("当前字号")).toHaveTextContent("16.5");
    fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
    expect(screen.getByLabelText("当前字号")).toHaveTextContent("6");
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(screen.getByLabelText("当前字号")).toHaveTextContent("72");
  });
  it("starts handle resizing without starting a label move", () => {
    const { slide, edge } = fixture();
    const move = vi.fn(),
      resize = vi.fn();
    render(
      <svg>
        <ConnectionLabels
          slide={slide}
          selected={edge.id}
          labelControlScale={0.5}
          onSelect={vi.fn()}
          onLabelPointerDown={move}
          onLabelResizePointerDown={resize}
        />
      </svg>,
    );
    fireEvent.pointerDown(screen.getByRole("slider"), { button: 0 });
    expect(
      Number(
        screen.getByRole("slider").querySelector("rect")!.getAttribute("width"),
      ) * 0.5,
    ).toBe(24);
    expect(resize).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
  });
  it("edits Chinese and multiline text, protects IME, and supports document undo/redo", () => {
    render(<EditorHarness />);
    fireEvent.click(screen.getByText("编辑"));
    const editor = screen.getByRole("textbox", { name: "编辑连线文字" });
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: "每轮读取\n更新后的消息" } });
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
    expect(screen.getByRole("textbox")).toBe(editor);
    expect(screen.getByLabelText("当前文字")).toHaveTextContent("每轮读取");
    fireEvent.compositionEnd(editor);
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(screen.getByRole("textbox")).toBe(editor);
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByLabelText("当前文字").textContent).toBe(
      "每轮读取\n更新后的消息",
    );
    fireEvent.click(screen.getByText("撤销"));
    expect(screen.getByLabelText("当前文字").textContent).toBe("每轮读取");
    fireEvent.click(screen.getByText("重做"));
    expect(screen.getByLabelText("当前文字").textContent).toBe(
      "每轮读取\n更新后的消息",
    );
  });
  it("double-clicks a label to edit and Escape discards the local draft", () => {
    const { container } = render(<EditorHarness />);
    fireEvent.doubleClick(container.querySelector("[data-connection-label]")!);
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "不保存" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByLabelText("当前文字").textContent).toBe("每轮读取");
  });
  it("renders a foreground mask and never offers read-only editing", () => {
    const { container } = render(<EditorHarness readOnly />);
    fireEvent.click(screen.getByText("编辑"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    const layer = container.querySelector(
      ".presentation-connection-label-layer",
    )!;
    expect(layer.nextElementSibling).toBeNull();
    expect(layer.querySelector("rect")).toHaveAttribute(
      "fill",
      fixture().slide.background,
    );
    expect(layer.querySelector("[data-connection-label]")).not.toHaveAttribute(
      "role",
    );
  });
});

describe("label position controls", () => {
  it("edits one offset axis while preserving the other and the bound connection", () => {
    const { slide, edge } = fixture();
    const onChange = vi.fn();
    render(
      <ConnectionPanel
        slide={slide}
        value={edge}
        creating={false}
        onChange={onChange}
        onOrder={vi.fn()}
        onCreate={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "文字水平偏移" }), {
      target: { value: "30" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      { label_offset: { x: 30, y: -16 } },
      "label-offset-x",
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "文字垂直偏移" }), {
      target: { value: "25" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      { label_offset: { x: 0, y: 25 } },
      "label-offset-y",
    );
  });
});
