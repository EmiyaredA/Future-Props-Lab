import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideCanvas } from "@features/presentation-workshop/SlideCanvas";
import { useSceneTools } from "@features/presentation-workshop/scene/SceneTools";
import { selectionAtHit } from "@features/presentation-workshop/scene/selection";
import {
  newElement,
  newSlide,
} from "@features/presentation-workshop/templates";
import type { Slide } from "@features/presentation-workshop/types";

vi.mock("@features/presentation-workshop/SlideTextEditor", () => ({
  SlideTextEditor: ({ onExit }: { onExit: () => void }) => (
    <textarea
      className="presentation-text-editor"
      aria-label="编辑幻灯片文字"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onExit();
        }
      }}
    />
  ),
}));

function fixture(): Slide {
  return {
    ...newSlide(),
    elements: [
      newElement("rect", { id: "a", x: 100, y: 100, width: 100, height: 100 }),
      newElement("text", {
        id: "label",
        x: 300,
        y: 100,
        width: 100,
        height: 100,
      }),
      newElement("rect", { id: "b", x: 500, y: 100, width: 100, height: 100 }),
      newElement("text", { id: "outside", x: 800, y: 400 }),
    ],
    groups: [
      { id: "root", name: "外层", parent_id: null, element_ids: ["b"] },
      {
        id: "child",
        name: "内层",
        parent_id: "root",
        element_ids: ["a", "label"],
      },
    ],
  };
}

const replace = vi.fn();
function Harness({
  initial = fixture(),
  readOnly = false,
}: {
  initial?: Slide;
  readOnly?: boolean;
}) {
  const [slide, setSlide] = useState(initial);
  const [selected, select] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const tools = useSceneTools({
    slide,
    selected,
    select,
    change: (update) => setSlide(update),
    readOnly,
  });
  return (
    <div
      className="presentation-center"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          if (tools.scope) tools.exitGroup();
          else select([]);
        }
      }}
    >
      {tools.scopeIndicator}
      <output aria-label="选区">{selected.join(",")}</output>
      <output aria-label="作用域">{tools.scope ?? "page"}</output>
      <output aria-label="页面数据">{JSON.stringify(slide)}</output>
      <button onClick={() => setSlide({ ...slide, groups: [] })}>
        移除分组
      </button>
      <button
        onClick={() => {
          select([]);
          setSlide({ ...slide, id: "other" });
        }}
      >
        切页
      </button>
      <SlideCanvas
        slide={slide}
        selected={selected}
        select={select}
        editing={editing}
        setEditing={setEditing}
        replace={(next) => {
          replace(next);
          setSlide(next);
        }}
        onText={vi.fn()}
        readOnly={readOnly}
        zoom={1}
        onReady={vi.fn()}
        onComposition={vi.fn()}

        groupScope={tools.scope}
        onGroupScopeChange={tools.selectInScope}
      />
    </div>
  );
}

function element(id: string) {
  return document.querySelector<HTMLElement>(
    `.presentation-canvas [data-element-id="${id}"]`,
  )!;
}
function tap(id: string, detail = 1, modifiers = {}) {
  const target = element(id);
  fireEvent.pointerDown(target, {
    button: 0,
    pointerId: 1,
    clientX: 120,
    clientY: 120,
    ...modifiers,
  });
  fireEvent.pointerUp(target, {
    pointerId: 1,
    clientX: 120,
    clientY: 120,
    ...modifiers,
  });
  fireEvent.click(target, { detail, ...modifiers });
}
function selected() {
  return screen
    .getByLabelText("选区")
    .textContent?.split(",")
    .filter(Boolean)
    .sort();
}
function scope() {
  return screen.getByLabelText("作用域").textContent;
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
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("组合逐层点击选择", () => {
  it("每次点击只进入一层，支持切换成员、返回和退出按钮", () => {
    render(<Harness />);
    tap("a");
    expect(selected()).toEqual(["a", "b", "label"]);
    expect(scope()).toBe("page");
    tap("a");
    expect(selected()).toEqual(["a", "label"]);
    expect(scope()).toBe("root");
    tap("label");
    expect(selected()).toEqual(["label"]);
    expect(scope()).toBe("child");
    tap("a");
    expect(selected()).toEqual(["a"]);
    fireEvent.keyDown(screen.getByRole("group", { name: "幻灯片画布" }), {
      key: "Escape",
    });
    expect(selected()).toEqual(["a", "label"]);
    expect(scope()).toBe("root");
    fireEvent.click(screen.getByRole("button", { name: "退出分组" }));
    expect(scope()).toBe("page");
    expect(selected()).toEqual(["a", "b", "label"]);
    expect(screen.getByRole("group", { name: "幻灯片画布" })).toHaveFocus();
    expect(replace).not.toHaveBeenCalled();
  });

  it("组外点击返回顶层，空白点击清空并退出", () => {
    render(<Harness />);
    tap("a");
    tap("a");
    tap("a");
    tap("b");
    expect(scope()).toBe("page");
    expect(selected()).toEqual(["a", "b", "label"]);
    tap("b");
    expect(scope()).toBe("root");
    tap("outside");
    expect(scope()).toBe("page");
    expect(selected()).toEqual(["outside"]);
    tap("a");
    tap("a");
    const canvas = screen.getByRole("group", { name: "幻灯片画布" });
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(scope()).toBe("page");
    expect(selected()).toEqual([]);
  });

  it("整组拖动与 4px 内抖动分离，Escape 和取消事件不会下钻或提交", () => {
    render(<Harness />);
    tap("a");
    const a = element("a"),
      canvas = screen.getByRole("group", { name: "幻灯片画布" });
    const drag = () => {
      fireEvent.pointerDown(a, {
        button: 0,
        pointerId: 1,
        clientX: 120,
        clientY: 120,
      });
      fireEvent.pointerMove(canvas, {
        pointerId: 1,
        clientX: 160,
        clientY: 140,
        altKey: true,
      });
    };
    drag();
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(scope()).toBe("page");
    expect(replace).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 160, clientY: 140 });
    drag();
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    expect(replace).not.toHaveBeenCalled();
    expect(scope()).toBe("page");
    drag();
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: 160,
      clientY: 140,
      altKey: true,
    });
    expect(scope()).toBe("page");
    const moved = replace.mock.calls[0][0] as Slide;
    for (const id of ["a", "b", "label"])
      expect(moved.elements.find((e) => e.id === id)?.x).toBe(
        fixture().elements.find((e) => e.id === id)!.x + 40,
      );
    expect(moved.elements.find((e) => e.id === "outside")?.x).toBe(800);
    fireEvent.pointerDown(a, {
      button: 0,
      pointerId: 1,
      clientX: 160,
      clientY: 140,
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 163, clientY: 140 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 163, clientY: 140 });
    expect(scope()).toBe("root");
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("锁定成员仍能选中，整组及成员都不能拖动", () => {
    const slide = fixture();
    slide.elements[0].locked = true;
    render(<Harness initial={slide} />);
    tap("label");
    tap("label");
    tap("a");
    expect(scope()).toBe("child");
    expect(selected()).toEqual(["a"]);
    fireEvent.pointerDown(element("a"), {
      button: 0,
      pointerId: 1,
      clientX: 120,
      clientY: 120,
    });
    fireEvent.pointerMove(element("a"), {
      pointerId: 1,
      clientX: 150,
      clientY: 120,
    });
    fireEvent.pointerUp(element("a"), {
      pointerId: 1,
      clientX: 150,
      clientY: 120,
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("下钻用的快速双击只选择，成员已选中时双击才编辑文字", () => {
    render(<Harness />);
    tap("label", 1);
    tap("label", 2);
    fireEvent.doubleClick(element("label"));
    expect(scope()).toBe("root");
    expect(screen.queryByRole("textbox")).toBeNull();
    tap("label", 1);
    expect(scope()).toBe("child");
    tap("label", 1);
    tap("label", 2);
    fireEvent.doubleClick(element("label"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(scope()).toBe("child");
    expect(selected()).toEqual(["label"]);
    expect(screen.getByRole("group", { name: "幻灯片画布" })).toHaveFocus();
  });

  it("普通文字仍可直接双击，分组移除和切页清理作用域", () => {
    render(<Harness />);
    tap("outside", 1);
    tap("outside", 2);
    fireEvent.doubleClick(element("outside"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    tap("a");
    tap("a");
    fireEvent.click(screen.getByRole("button", { name: "切页" }));
    expect(scope()).toBe("page");
    tap("a");
    tap("a");
    expect(scope()).toBe("root");
    fireEvent.click(screen.getByRole("button", { name: "移除分组" }));
    expect(scope()).toBe("page");
  });

  it.each(["shiftKey", "metaKey", "ctrlKey"])("%s 多选不会下钻", (key) => {
    const s = fixture();
    expect(
      selectionAtHit(s, ["a", "b", "label", "outside"], "a", null, false).drill,
    ).toBeNull();
    render(<Harness />);
    tap("a");
    tap("a", 1, { [key]: true });
    expect(scope()).toBe("page");
    expect(selected()).toEqual([]);
  });

  it("只读画布不进入组内或编辑状态", () => {
    render(<Harness readOnly />);
    tap("label", 1);
    tap("label", 2);
    fireEvent.doubleClick(element("label"));
    expect(scope()).toBe("page");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
