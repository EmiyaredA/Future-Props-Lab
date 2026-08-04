import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";

test("uses the project confirmation dialog for destructive actions", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      open
      title="删除助手对话"
      description="删除后无法恢复。"
      confirmLabel="删除对话"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );

  const dialog = screen.getByRole("alertdialog", { name: "删除助手对话" });
  expect(dialog).toHaveTextContent("删除后无法恢复。");
  await user.click(within(dialog).getByRole("button", { name: "删除对话" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onCancel).not.toHaveBeenCalled();
});

test("supports Escape and blocks dismissal while an action is pending", () => {
  const onCancel = vi.fn();
  document.body.style.overflow = "hidden";
  const { rerender, unmount } = render(
    <ConfirmDialog
      open
      title="删除日志"
      description="删除后无法恢复。"
      onCancel={onCancel}
      onConfirm={vi.fn()}
    />,
  );

  fireEvent.keyDown(window, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();

  rerender(
    <ConfirmDialog
      open
      title="删除日志"
      description="删除后无法恢复。"
      pending
      onCancel={onCancel}
      onConfirm={vi.fn()}
    />,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "处理中…" })).toBeDisabled();
  unmount();
  expect(document.body.style.overflow).toBe("hidden");
  document.body.style.overflow = "";
});
