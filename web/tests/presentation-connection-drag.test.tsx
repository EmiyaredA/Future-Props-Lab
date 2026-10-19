import { act, renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { PointerEvent, KeyboardEvent } from "react";
import {
  newElement,
  newSlide,
} from "@features/presentation-workshop/templates";
import { newConnection } from "@features/presentation-workshop/scene/connectionEditing";
import { useConnectionDrag } from "@features/presentation-workshop/scene/useConnectionDrag";

function setup() {
  const slide = newSlide();
  slide.elements = [
    newElement("rect", { id: "a", x: 100, y: 200, width: 180, height: 100 }),
    newElement("rect", { id: "b", x: 700, y: 300, width: 250, height: 200 }),
  ];
  const edge = newConnection(slide, ["a", "b"]);
  slide.connections = [edge];
  const element = document.createElement("div"),
    button = document.createElement("button");
  const canvas = { current: element };
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1280, height: 720 }) as DOMRect;
  element.setPointerCapture = vi.fn();
  element.releasePointerCapture = vi.fn();
  element.hasPointerCapture = () => true;
  const commit = vi.fn();
  const hook = renderHook(
    (props) => useConnectionDrag({ ...props, canvas, scale: 1, commit }),
    { initialProps: { slide, selected: edge.id, readOnly: false } },
  );
  const event = (x: number, y: number) =>
    ({
      pointerId: 1,
      button: 0,
      clientX: x,
      clientY: y,
      currentTarget: button,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }) as unknown as PointerEvent;
  const start = () =>
    act(() =>
      hook.result.current.start(
        event(490, 325),
        edge,
        { kind: "segment", index: 1 },
        { x: 490, y: 325 },
      ),
    );
  return { ...hook, slide, edge, element, commit, event, start };
}

describe("connection drag lifetime", () => {
  it("keeps previews out of the document and commits exactly once", () => {
    const h = setup();
    h.start();
    act(() => h.result.current.move(h.event(550, 325)));
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.result.current.preview?.waypoints).toEqual([
      { x: 550, y: 250 },
      { x: 550, y: 400 },
    ]);
    expect(h.slide.connections![0].waypoints).toEqual([]);
    act(() => h.result.current.finish(h.event(550, 325)));
    expect(h.commit).toHaveBeenCalledTimes(1);
    act(() => h.result.current.finish(h.event(550, 325)));
    expect(h.commit).toHaveBeenCalledTimes(1);
  });
  it("does not commit a click or a cancelled preview", () => {
    const h = setup();
    h.start();
    act(() => h.result.current.finish(h.event(492, 325)));
    expect(h.commit).not.toHaveBeenCalled();
    h.start();
    act(() => h.result.current.move(h.event(550, 325)));
    act(() => h.result.current.cancel());
    act(() => h.result.current.finish(h.event(550, 325)));
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.result.current.preview).toBeNull();
  });
  it.each(["page", "permission", "selection", "document"])(
    "cancels when %s changes",
    (reason) => {
      const h = setup();
      h.start();
      act(() => h.result.current.move(h.event(550, 325)));
      h.rerender({
        slide:
          reason === "page"
            ? { ...h.slide, id: "next" }
            : reason === "document"
              ? { ...h.slide }
              : h.slide,
        selected: reason === "selection" ? "other" : h.edge.id,
        readOnly: reason === "permission",
      });
      expect(h.result.current.active()).toBe(false);
      expect(h.result.current.preview).toBeNull();
      expect(h.commit).not.toHaveBeenCalled();
    },
  );
  it("cancels on window blur and rejects read-only gestures", () => {
    const h = setup();
    h.start();
    act(() => window.dispatchEvent(new Event("blur")));
    expect(h.result.current.active()).toBe(false);
    expect(h.element.releasePointerCapture).toHaveBeenCalledWith(1);
    h.rerender({ slide: h.slide, selected: h.edge.id, readOnly: true });
    h.start();
    expect(h.result.current.active()).toBe(false);
    expect(h.commit).not.toHaveBeenCalled();
  });
  it("requires a valid edge projection and never binds to the other endpoint's node", () => {
    const h = setup();
    act(() =>
      h.result.current.start(
        h.event(700, 400),
        h.edge,
        { kind: "target", index: 3 },
        { x: 700, y: 400 },
      ),
    );
    act(() => h.result.current.move(h.event(700, 340)));
    expect(h.result.current.preview?.target_offset).toBe(0.2);
    act(() => h.result.current.move(h.event(100, 200)));
    expect(h.result.current.preview).toBeNull();
    act(() => h.result.current.finish(h.event(100, 200)));
    expect(h.commit).not.toHaveBeenCalled();
  });
  it("uses keyboard steps along a side and cycles connections across it", () => {
    const h = setup();
    const key = (name: string, shiftKey = false) =>
      ({
        key: name,
        shiftKey,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }) as unknown as KeyboardEvent;
    act(() =>
      h.result.current.key(
        key("ArrowUp", true),
        h.edge,
        { kind: "target", index: 3 },
        { x: 700, y: 400 },
      ),
    );
    expect(h.commit.mock.calls[0][0].connections[0].target_offset).toBe(0.4);
    act(() =>
      h.result.current.key(
        key("ArrowRight"),
        h.edge,
        { kind: "target", index: 3 },
        { x: 700, y: 400 },
      ),
    );
    expect(h.commit.mock.calls[1][0].connections[0]).toMatchObject({
      target_id: "b",
      target_anchor: "right",
    });
  });
});
