import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { expect, test, vi } from "vitest";
import { useConfirmation } from "@shared/ui/useConfirmation";

function Harness({
  result,
  pending = false,
}: {
  result: (accepted: boolean) => void;
  pending?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const confirmation = useConfirmation({
    portalContainer: container.current,
    pending,
  });
  return (
    <>
      <div ref={container} data-testid="confirmation-container" />
      <button
        onClick={() =>
          void confirmation
            .confirm({
              title: "舍弃草稿？",
              description: "未保存的内容会被舍弃。",
              confirmLabel: "舍弃",
              cancelLabel: "继续编辑",
            })
            .then(result)
        }
      >
        关闭编辑器
      </button>
      {confirmation.dialog}
    </>
  );
}

test("confirmation is asynchronous, scoped to its container, cancellable and restores focus", async () => {
  const result = vi.fn();
  render(<Harness result={result} />);
  const trigger = screen.getByRole("button", { name: "关闭编辑器" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("alertdialog", { name: "舍弃草稿？" });
  expect(screen.getByTestId("confirmation-container")).toContainElement(dialog);
  expect(result).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  await act(async () => {});
  expect(result).toHaveBeenLastCalledWith(false);
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: /^舍弃$/ }));
  await act(async () => {});
  expect(result).toHaveBeenLastCalledWith(true);
});

test("a second action cannot replace an open decision; unmount declines pending work", async () => {
  const result = vi.fn();
  const view = render(<Harness result={result} />);
  const trigger = screen.getByRole("button", { name: "关闭编辑器" });
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  await act(async () => {});
  expect(result).toHaveBeenCalledOnce();
  expect(result).toHaveBeenLastCalledWith(false);
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  view.unmount();
  await act(async () => {});
  expect(result).toHaveBeenCalledTimes(2);
  expect(result).toHaveBeenLastCalledWith(false);
});

test("in-flight work prevents confirming or cancelling until the caller unlocks it", async () => {
  const result = vi.fn();
  const view = render(<Harness result={result} pending />);
  fireEvent.click(screen.getByRole("button", { name: "关闭编辑器" }));
  const dialog = screen.getByRole("alertdialog");
  expect(
    within(dialog).getByRole("button", { name: "处理中…" }),
  ).toBeDisabled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(result).not.toHaveBeenCalled();
  view.rerender(<Harness result={result} />);
  fireEvent.click(within(dialog).getByRole("button", { name: "继续编辑" }));
  await act(async () => {});
  expect(result).toHaveBeenCalledWith(false);
});
