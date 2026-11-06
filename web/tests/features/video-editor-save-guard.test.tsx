import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { VideoEditorSaveGuard } from "@features/video-editor/VideoEditorSaveGuard";

it("waits for pending writes before completing navigation", () => {
  const register = vi.fn();
  const discard = vi.fn();
  const proceed = vi.fn();
  const props = { register, discard, unsaved: true, busy: true };
  const { rerender } = render(<VideoEditorSaveGuard {...props} />);
  act(() => expect(register.mock.calls[0][0](proceed)).toBe(true));
  expect(screen.getByRole("alertdialog", { name: "正在保存" })).toBeVisible();
  expect(screen.getByRole("button", { name: "等待保存完成" })).toBeDisabled();
  expect(proceed).not.toHaveBeenCalled();
  rerender(<VideoEditorSaveGuard {...props} unsaved={false} busy={false} />);
  expect(proceed).toHaveBeenCalledOnce();
  expect(discard).not.toHaveBeenCalled();
});
it.each(["留在编辑器", "关闭确认弹窗", "Escape"])(
  "allows %s while a save is pending without discarding or leaving later",
  (action) => {
    const register = vi.fn();
    const discard = vi.fn();
    const proceed = vi.fn();
    const props = { register, discard, unsaved: true, busy: true };
    const { rerender } = render(<VideoEditorSaveGuard {...props} />);
    act(() => register.mock.calls[0][0](proceed));
    if (action === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(discard).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    rerender(<VideoEditorSaveGuard {...props} unsaved={false} busy={false} />);
    expect(proceed).not.toHaveBeenCalled();
  },
);
it("allows explicit discard after a pending save fails", () => {
  const register = vi.fn();
  const discard = vi.fn(() => true);
  const proceed = vi.fn();
  const props = { register, discard, unsaved: true };
  const { rerender } = render(<VideoEditorSaveGuard {...props} busy />);
  act(() => register.mock.calls[0][0](proceed));
  rerender(
    <VideoEditorSaveGuard
      {...props}
      busy={false}
      failedCount={1}
      operations={["片段编辑"]}
    />,
  );
  expect(proceed).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("片段编辑");
  fireEvent.click(screen.getByRole("button", { name: "放弃未保存操作" }));
  expect(discard).toHaveBeenCalledOnce();
  expect(proceed).toHaveBeenCalledOnce();
});
it("requires explicit discard after failed navigation and supports cancel", () => {
  const register = vi.fn();
  const discard = vi.fn(() => true);
  const proceed = vi.fn();
  render(
    <VideoEditorSaveGuard
      register={register}
      discard={discard}
      unsaved
      busy={false}
      failedCount={2}
      operations={["edit", "undo"]}
    />,
  );
  act(() => register.mock.calls[0][0](proceed));
  fireEvent.click(screen.getByRole("button", { name: "留在编辑器" }));
  expect(discard).not.toHaveBeenCalled();
  expect(proceed).not.toHaveBeenCalled();
  act(() => register.mock.calls[0][0](proceed));
  fireEvent.click(screen.getByRole("button", { name: "放弃未保存操作" }));
  expect(discard).toHaveBeenCalledOnce();
  expect(proceed).toHaveBeenCalledOnce();
});
it("protects window closure and removes navigation handlers on disposal", () => {
  const register = vi.fn();
  const { unmount } = render(
    <VideoEditorSaveGuard register={register} discard={vi.fn()} unsaved />,
  );
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  unmount();
  expect(register).toHaveBeenLastCalledWith(null);
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
