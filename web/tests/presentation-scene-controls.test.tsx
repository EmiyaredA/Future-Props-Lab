import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ConnectionPanel } from "@features/presentation-workshop/scene/ConnectionPanel";
import { newConnection } from "@features/presentation-workshop/scene/connectionEditing";
import { beforeEach, afterEach } from "vitest";
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());
import { useSceneTools } from "@features/presentation-workshop/scene/SceneTools";
import {
  newSlide,
  newElement,
} from "@features/presentation-workshop/templates";

const slide = {
  ...newSlide(),
  elements: [newElement("rect", { id: "a" }), newElement("text", { id: "b" })],
};

describe("原生场景控件", () => {
  it("单选第二个节点时，新建连接自动选择不同终点，键盘可提交", async () => {
    const apply = vi.fn();
    render(
      <ConnectionPanel
        slide={slide}
        value={newConnection(slide, ["b"])}
        creating
        position={null}
        onMove={vi.fn()}
        onChange={vi.fn()}
        onOrder={vi.fn()}
        onCreate={apply}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "创建连接" });
    expect(button).toBeEnabled();
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(newConnection(slide, ["b"])).toMatchObject({
      source_id: "b",
      target_id: "a",
    });
    expect(apply).toHaveBeenCalledOnce();
  });
  it("只读文稿不开放信息图、布局、连接和分组写入入口", () => {
    const change = vi.fn();
    function Harness() {
      const tools = useSceneTools({
        slide,
        selected: ["a", "b"],
        select: vi.fn(),
        change,
        readOnly: true,
      });
      return (
        <>
          {tools.infoAction && (
            <button onClick={tools.infoAction.onSelect}>
              {tools.infoAction.label}
            </button>
          )}
          {tools.actions.map((action) => (
            <button
              key={action.label}
              disabled={action.disabled}
              onClick={action.onSelect}
            >
              {action.label}
            </button>
          ))}
          {tools.dialogs}
        </>
      );
    }
    render(<Harness />);
    expect(
      screen.queryByRole("toolbar", { name: "信息图与重建工具" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });
});
