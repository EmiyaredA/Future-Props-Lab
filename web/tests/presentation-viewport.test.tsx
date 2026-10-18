import { useRef, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSlideViewport } from "@features/presentation-workshop/useSlideViewport";
import { SlideCanvas } from "@features/presentation-workshop/SlideCanvas";
import { newDeck } from "@features/presentation-workshop/templates";

let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function setup({ blocked = false } = {}) {
  const changes = vi.fn();
  function Viewport({ blocked }: { blocked: boolean }) {
    const host = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState<number | null>(1);
    const scale = useSlideViewport({
      host,
      canvas,
      zoom,
      onZoomChange: (value) => {
        changes(value);
        setZoom(value);
      },
      isZoomBlocked: () => blocked,
    });
    return (
      <>
        <div ref={host} data-testid="area">
          <div
            ref={canvas}
            data-testid="slide"
            style={{ transform: `scale(${scale})` }}
          />
        </div>
        <output>{scale}</output>
        <button onClick={() => setZoom(null)}>fit</button>
        <button onClick={() => setZoom(1.5)}>150%</button>
      </>
    );
  }
  const view = render(<Viewport blocked={blocked} />);
  const area = screen.getByTestId("area");
  const slide = screen.getByTestId("slide");
  let width = 688,
    height = 408;
  Object.defineProperties(area, {
    clientWidth: { get: () => width },
    clientHeight: { get: () => height },
  });
  vi.spyOn(area, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        left: 0,
        top: 0,
        width,
        height,
      }) as DOMRect,
  );
  vi.spyOn(slide, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        left: 24 - area.scrollLeft,
        top: 24 - area.scrollTop,
      }) as DOMRect,
  );
  act(() => {
    resize();
    fireEvent.scroll(area);
  });
  const wheel = (options: WheelEventInit = {}) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 200,
      deltaY: -100,
      ctrlKey: true,
      ...options,
    });
    act(() => {
      area.dispatchEvent(event);
    });
    return event;
  };
  return {
    ...view,
    changes,
    area,
    wheel,
    block: (blocked: boolean) => view.rerender(<Viewport blocked={blocked} />),
    resize: (w: number, h: number) => {
      width = w;
      height = h;
      act(() => resize());
    },
  };
}

it("Ctrl 捏合和 ⌘ 滚轮连续缩放，普通滚轮保持默认滚动", () => {
  const { wheel, changes } = setup();
  expect(wheel({ ctrlKey: false }).defaultPrevented).toBe(false);
  expect(changes).not.toHaveBeenCalled();
  expect(wheel().defaultPrevented).toBe(true);
  expect(Number(screen.getByRole("status").textContent)).toBeCloseTo(
    Math.exp(0.2),
  );
  wheel({ ctrlKey: false, metaKey: true });
  expect(Number(screen.getByRole("status").textContent)).toBeCloseTo(
    Math.exp(0.4),
  );
  wheel({ deltaY: 100 });
  expect(Number(screen.getByRole("status").textContent)).toBeCloseTo(
    Math.exp(0.2),
  );
});

it("同一帧的连续事件累积比例，并按最新鼠标位置补偿滚动", () => {
  const { area } = setup();
  act(() => {
    for (let i = 0; i < 3; i++)
      area.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -10,
          clientX: 300,
          clientY: 200,
        }),
      );
  });
  const scale = Math.exp(0.06);
  expect(Number(screen.getByRole("status").textContent)).toBeCloseTo(scale);
  expect(area.scrollLeft).toBeCloseTo(276 * (scale - 1));
  expect(area.scrollTop).toBeCloseTo(176 * (scale - 1));
});

it("手势限幅并归一化行与页单位，达到边界仍拦截浏览器缩放", () => {
  const { wheel } = setup();
  wheel({ deltaY: -1000, deltaMode: 1 });
  expect(screen.getByRole("status")).toHaveTextContent("2");
  expect(wheel().defaultPrevented).toBe(true);
  for (let i = 0; i < 4; i++) wheel({ deltaY: 2, deltaMode: 2 });
  expect(screen.getByRole("status")).toHaveTextContent("0.25");
  expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(true);
});

it("变换或裁剪期间消耗缩放事件且不改变比例，结束后恢复", () => {
  const { wheel, changes, block } = setup({ blocked: true });
  expect(wheel().defaultPrevented).toBe(true);
  expect(changes).not.toHaveBeenCalled();
  block(false);
  wheel();
  expect(changes).toHaveBeenCalledOnce();
});

it("底部控件围绕可视中心缩放，适应模式重置滚动并响应窗口变化", () => {
  const { area, resize } = setup();
  fireEvent.click(screen.getByText("150%"));
  expect(area.scrollLeft).toBeCloseTo((688 / 2 - 24) * 0.5);
  expect(area.scrollTop).toBeCloseTo((408 / 2 - 24) * 0.5);
  fireEvent.click(screen.getByText("fit"));
  expect(screen.getByRole("status")).toHaveTextContent("0.5");
  expect(area.scrollLeft).toBe(0);
  expect(area.scrollTop).toBe(0);
  resize(1328, 768);
  expect(screen.getByRole("status")).toHaveTextContent("1");
});

it("卸载时移除监听并释放 ResizeObserver", () => {
  const { area, unmount, changes } = setup();
  const remove = vi.spyOn(area, "removeEventListener");
  unmount();
  expect(remove).toHaveBeenCalledWith("wheel", expect.any(Function));
  expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  expect(disconnect).toHaveBeenCalledOnce();
  const event = new WheelEvent("wheel", {
    ctrlKey: true,
    deltaY: -100,
    cancelable: true,
  });
  area.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(changes).not.toHaveBeenCalled();
});

it("适应比例低于手动下限时，缩小手势不会反向放大", () => {
  const { resize, wheel, changes } = setup();
  resize(200, 200);
  fireEvent.click(screen.getByText("fit"));
  const fitted = Number(screen.getByRole("status").textContent);
  expect(fitted).toBeLessThan(0.25);
  wheel({ deltaY: 100 });
  expect(changes).not.toHaveBeenCalled();
  expect(Number(screen.getByRole("status").textContent)).toBe(fitted);
  wheel();
  expect(screen.getByRole("status")).toHaveTextContent("0.25");
});

it("适应比例使用实际留白，零留白与窄屏留白均不会被固定值替代", () => {
  const { area, resize } = setup();
  area.style.padding = "20px 12px";
  resize(664, 400);
  fireEvent.click(screen.getByText("fit"));
  expect(screen.getByRole("status")).toHaveTextContent("0.5");
  area.style.padding = "0px";
  resize(1280, 720);
  expect(screen.getByRole("status")).toHaveTextContent("1");
});

it.each([false, true])(
  "实际画布支持只读=%s 的缩放，且不修改文稿或选区",
  (readOnly) => {
    const props = {
      slide: newDeck("blank").slides[0],
      selected: [],
      select: vi.fn(),
      editing: null,
      setEditing: vi.fn(),
      replace: vi.fn(),
      onText: vi.fn(),
      readOnly,
      zoom: 1,
      onZoomChange: vi.fn(),
      onReady: vi.fn(),
      onComposition: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    };
    const { rerender } = render(<SlideCanvas {...props} />);
    const canvas = screen.getByRole("group", { name: "幻灯片画布" });
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100 });
    expect(props.onZoomChange).toHaveBeenCalledWith(Math.exp(0.2));
    expect(props.replace).not.toHaveBeenCalled();
    expect(props.onText).not.toHaveBeenCalled();
    expect(props.select).not.toHaveBeenCalled();
    expect(props.setEditing).not.toHaveBeenCalled();
    props.onZoomChange.mockClear();
    rerender(<SlideCanvas {...props} cropOverlay={<div>裁剪中</div>} />);
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100 });
    expect(props.onZoomChange).not.toHaveBeenCalled();
  },
);
