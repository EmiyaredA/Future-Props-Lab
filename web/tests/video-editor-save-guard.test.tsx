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
  expect(screen.getByRole("button", { name: "处理中…" })).toBeDisabled();
  expect(proceed).not.toHaveBeenCalled();
  rerender(<VideoEditorSaveGuard {...props} unsaved={false} busy={false} />);
  expect(proceed).toHaveBeenCalledOnce();
  expect(discard).not.toHaveBeenCalled();
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
