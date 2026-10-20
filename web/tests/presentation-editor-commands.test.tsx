import { newConnection } from "@features/presentation-workshop/scene/connectionEditing";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  editorCommands,
  type CommandId,
} from "@features/presentation-workshop/editor/commands";
import { SelectionPanel } from "@features/presentation-workshop/editor/SelectionPanel";
import { SlideSurface } from "@features/presentation-workshop/SlideSurface";
import { applyLayout } from "@features/presentation-workshop/layoutObjects";
import {
  newElement,
  newSlide,
} from "@features/presentation-workshop/templates";

it("menu actions and shortcuts enforce the same editing and lock boundary", () => {
  const action = vi.fn();
  const ids: CommandId[] = [
    "save",
    "undo",
    "redo",
    "duplicate",
    "remove",
    "selectAll",
    "lock",
    "unlock",
    "front",
    "forward",
    "backward",
    "back",
    "left",
    "right",
    "up",
    "down",
  ];
  const handlers = Object.fromEntries(
    ids.map((id) => [id, action]),
  ) as unknown as Record<CommandId, () => void>;
  const create = (readOnly = false, blocked = false, movable = 1) =>
    editorCommands({
      readOnly,
      blocked,
      selected: 1,
      movable,
      canUndo: true,
      canRedo: false,
      handlers,
    });
  for (const commands of [create(true), create(false, true)]) {
    for (const id of ids) {
      expect(commands.get(id).disabled).toBe(true);
      commands.get(id).onSelect();
      commands.run(id);
    }
  }
  expect(action).not.toHaveBeenCalled();
  create(false, false, 0).run("remove");
  expect(action).not.toHaveBeenCalled();
  create(false, false, 0).get("unlock").onSelect();
  expect(action).toHaveBeenCalledTimes(1);
  create().run("left", 10);
  expect(action).toHaveBeenLastCalledWith(10);
  expect(create().get("redo").disabled).toBe(true);
});

it("hidden nodes and their bound edges do not appear in a sized slide surface", () => {
  const slide = {
    ...newSlide(),
    elements: [
      newElement("rect", { id: "a", hidden: true }),
      newElement("text", { id: "b" }),
    ],
    connections: [
      {
        ...newConnection(newSlide(), []),
        id: "edge",
        source_id: "a",
        target_id: "b",
      },
    ],
  };
  const { container } = render(
    <SlideSurface slide={slide} size={{ width: 960, height: 720 }} />,
  );
  expect(container.querySelector('[data-element-id="a"]')).toBeNull();
  expect(container.querySelector('[data-element-id="b"]')).not.toBeNull();
  expect(container.querySelector('[data-connection-id="edge"]')).toBeNull();
  expect(container.querySelector(".presentation-slide")).toHaveStyle({
    width: "960px",
    height: "720px",
  });
});

it("selection panel preserves connection stacking and sends targeted changes", () => {
  const a = newElement("rect", { id: "a", name: "底层" }),
    b = newElement("text", { id: "b", name: "标题", locked: true });
  const slide = {
    ...newSlide(),
    elements: [a, b],
    connections: [
      {
        ...newConnection(newSlide(), []),
        id: "edge",
        source_id: "a",
        target_id: "b",
        layer: 1,
      },
    ],
  };
  const patch = vi.fn(),
    select = vi.fn(),
    order = vi.fn();
  render(
    <SelectionPanel
      slide={slide}
      selected={[]}
      readOnly={false}
      patch={patch}
      select={select}
      order={order}
    />,
  );
  const rows = screen.getAllByRole("listitem");
  expect(rows[0]).toContainElement(screen.getByLabelText("元素名称 b"));
  expect(rows[1]).toHaveTextContent("连接线");
  fireEvent.change(screen.getByLabelText("元素名称 a"), {
    target: { value: "背景" },
  });
  expect(patch).toHaveBeenLastCalledWith("a", { name: "背景" });
  fireEvent.click(screen.getByRole("button", { name: "隐藏 底层" }));
  expect(patch).toHaveBeenLastCalledWith("a", { hidden: true });
  expect(screen.getByRole("button", { name: "隐藏 标题" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "解锁 标题" }));
  expect(patch).toHaveBeenLastCalledWith("b", { locked: false });
  fireEvent.click(screen.getByRole("button", { name: "上移 底层" }));
  expect(order).toHaveBeenCalledWith("a", "forward");
});

it("canvas alignment uses the explicit page size", () => {
  const item = newElement("rect", { id: "a", x: 10, width: 100 });
  const result = applyLayout(
    { ...newSlide(), elements: [item] },
    ["a"],
    null,
    "right",
    { width: 960, height: 720 },
  );
  expect(result.elements[0].x).toBe(860);
});
