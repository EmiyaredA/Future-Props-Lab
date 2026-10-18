import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSceneTools } from "@features/presentation-workshop/scene/SceneTools";
import { Connections } from "@features/presentation-workshop/scene/Connections";
import {
  patchConnection,
  validConnection,
} from "@features/presentation-workshop/scene/connectionEditing";
import { newDeck, newElement } from "@features/presentation-workshop/templates";
import { usePresentationDraft } from "@features/presentation-workshop/usePresentationDraft";
import type { Project } from "@features/presentation-workshop/types";

vi.mock("@features/presentation-workshop/api", () => ({
  saveProject: vi.fn(),
  createProject: vi.fn(),
}));
let resize: () => void;
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());
function fixture(): Project {
  const document = newDeck("blank");
  document.slides[0].elements = ["a", "b", "c"].map((id, i) =>
    newElement("rect", { id, x: i * 300 }),
  );
  document.slides[0].connections = [
    {
      arrow: true,
      source_anchor: "right",
      target_anchor: "left",
      style: "step",
      id: "ab",
      source_id: "a",
      target_id: "b",
      label: "第一条",
      width: 2,
      color: "#365F62",
      waypoints: [{ x: 250, y: 50 }],
    },
    {
      arrow: true,
      color: "#365F62",
      source_anchor: "right",
      target_anchor: "left",
      style: "step",
      id: "bc",
      source_id: "b",
      target_id: "c",
      label: "第二条",
      width: 4,
    },
  ];
  return {
    id: "test",
    title: "测试",
    revision: 0,
    created_at: "2026-10-19",
    updated_at: "2026-10-19",
    document,
  };
}
function Harness({ readOnly = false }: { readOnly?: boolean }) {
  const draft = usePresentationDraft(fixture(), vi.fn());
  const [selected, select] = useState<string[]>(["b"]);
  const [other, setOther] = useState(false);
  const tools = useSceneTools({
    slide: {
      ...draft.draft.document.slides[0],
      ...(other ? { id: "other" } : {}),
    },
    selected,
    select,
    readOnly,
    onComposition: draft.setComposition,
    change: (update, group) =>
      draft.commit(
        (d) => ({
          ...d,
          document: { ...d.document, slides: [update(d.document.slides[0])] },
        }),
        group,
      ),
  });
  return (
    <div>
      <button onClick={() => tools.onSelectEdge("ab")}>第一条</button>
      <button onClick={() => tools.onSelectEdge("bc")}>第二条</button>
      <button
        onClick={() =>
          tools.actions.find((a) => a.label === "连接节点")?.onSelect()
        }
      >
        新建
      </button>
      <button onClick={() => select(["a"])}>选元素</button>
      <button onClick={() => setOther(true)}>切页</button>
      <button onClick={draft.undo}>撤销</button>
      <button onClick={draft.redo}>重做</button>
      <output aria-label="文稿">
        {JSON.stringify(draft.draft.document.slides[0])}
      </output>
      <output aria-label="选区">{selected.join(",")}</output>
      <output aria-label="预览">
        {JSON.stringify(tools.previewConnection)}
      </output>
      <div>
        <div className="presentation-canvas" tabIndex={0} />
        {tools.connectionPanel}
      </div>
      <Connections
        slide={draft.draft.document.slides[0]}
        selected={tools.edgeId}
      />
    </div>
  );
}
const data = () => JSON.parse(screen.getByLabelText("文稿").textContent!);
const panel = () => screen.getByRole("region", { name: "连接线调节" });

describe("连接浮动面板", () => {
  it("实时修改保留路径，文本连续编辑合并历史，撤销重做直接同步面板", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "第一条" }));
    expect(screen.getByLabelText("选区")).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "应用连接" }),
    ).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("连接标签"), "中文");
    expect(data().connections[0].label).toBe("第一条中文");
    expect(data().connections[0].waypoints).toEqual([{ x: 250, y: 50 }]);
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("连接标签")).toHaveValue("第一条");
    await userEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByLabelText("连接标签")).toHaveValue("第一条中文");
    fireEvent.change(screen.getByLabelText("连接粗细滑杆"), {
      target: { value: "5" },
    });
    expect(data().connections[0].width).toBe(5);
    const path = document.querySelector(
      '[data-connection-id="ab"] path[marker-end]',
    );
    expect(path).toHaveAttribute("stroke-width", "5");
    expect(data().connections[0].waypoints).toHaveLength(1);
    await userEvent.click(
      within(panel()).getByRole("button", { name: "直线" }),
    );
    expect(data().connections[0].waypoints).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "关闭连接设置" }));
    expect(data().connections[0].style).toBe("straight");
  });

  it("新建只预览，取消不写入；创建、删除、撤销均不重复添加", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "新建" }));
    expect(
      JSON.parse(screen.getByLabelText("预览").textContent!),
    ).toMatchObject({ source_id: "b", target_id: "a" });
    expect(data().connections).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "关闭连接设置" }));
    expect(data().connections).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "新建" }));
    await userEvent.click(screen.getByRole("button", { name: "创建连接" }));
    expect(data().connections).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "删除连接" }));
    expect(data().connections).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(data().connections).toHaveLength(3);
    expect(
      screen.queryByRole("region", { name: "连接线调节" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(data().connections).toHaveLength(2);
  });

  it("切换连接读取当前状态，选择元素、切页和只读关闭；禁止同节点", async () => {
    const view = render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "第一条" }));
    await userEvent.click(screen.getByRole("button", { name: "第二条" }));
    expect(screen.getByLabelText("连接标签")).toHaveValue("第二条");
    await userEvent.click(screen.getByRole("button", { name: /^连接端点/ }));
    await userEvent.click(screen.getByRole("combobox", { name: "连接起点" }));
    const opposite = screen
      .getAllByRole("option")
      .find(
        (o) =>
          o.getAttribute("aria-selected") === "false" &&
          o.hasAttribute("disabled"),
      );
    expect(opposite).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(panel()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "选元素" }));
    expect(
      screen.queryByRole("region", { name: "连接线调节" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "第一条" }));
    view.rerender(<Harness readOnly />);
    expect(
      screen.queryByRole("region", { name: "连接线调节" }),
    ).not.toBeInTheDocument();
    view.rerender(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "第一条" }));
    await userEvent.click(screen.getByRole("button", { name: "切页" }));
    expect(
      screen.queryByRole("region", { name: "连接线调节" }),
    ).not.toBeInTheDocument();
  });

  it("Esc 先关闭选色器，再关面板回焦，文字输入不触发外部快捷键", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "第一条" }));
    await userEvent.click(screen.getByRole("button", { name: "连接颜色" }));
    await userEvent.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "连接颜色选色器" }),
    ).not.toBeInTheDocument();
    expect(panel()).toBeInTheDocument();
    const input = screen.getByLabelText("连接标签");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "关系说明" } });
    fireEvent.compositionEnd(input);
    expect(data().connections[0].label).toBe("关系说明");
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".presentation-canvas")).toHaveFocus();
  });

  it("位置随键盘移动、展开与窗口改变限幅，重开记住位置", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "第一条" }));
    const root = panel(),
      host = root.parentElement!;
    let width = 800;
    vi.spyOn(host, "getBoundingClientRect").mockImplementation(
      () => ({ width, height: 700, left: 0, top: 0 }) as DOMRect,
    );
    Object.defineProperties(root, {
      offsetWidth: { value: 300 },
      offsetHeight: { value: 400 },
    });
    act(() => resize());
    expect(root.style.left).toBe("488px");
    const grip = screen.getByRole("button", { name: "移动连接调节面板" });
    grip.focus();
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(root.style.left).toBe("478px");
    await userEvent.click(screen.getByRole("button", { name: "关闭连接设置" }));
    await userEvent.click(screen.getByRole("button", { name: "第一条" }));
    width = 390;
    const reopened = panel();
    vi.spyOn(
      reopened.parentElement!,
      "getBoundingClientRect",
    ).mockImplementation(
      () => ({ width, height: 700, left: 0, top: 0 }) as DOMRect,
    );
    Object.defineProperties(reopened, {
      offsetWidth: { value: 300 },
      offsetHeight: { value: 600 },
    });
    act(() => resize());
    expect(reopened.style.left).toBe("78px");
    expect(reopened.style.maxWidth).toBe("366px");
  });
});

it("仅连接几何变化清除布局路径，非法端点无法通过验证", () => {
  const slide = fixture().document.slides[0],
    edge = slide.connections![0];
  expect(
    patchConnection(edge, {
      color: "#FFFFFF",
      width: 8,
      label: "更新",
      arrow: false,
    }).waypoints,
  ).toBe(edge.waypoints);
  for (const patch of [
    { source_id: "c" },
    { target_id: "c" },
    { source_anchor: "top" as const },
    { target_anchor: "bottom" as const },
    { style: "straight" as const },
  ])
    expect(patchConnection(edge, patch).waypoints).toEqual([]);
  expect(validConnection(slide, { ...edge, target_id: "a" })).toBe(false);
  expect(validConnection(slide, { ...edge, target_id: "missing" })).toBe(false);
});
