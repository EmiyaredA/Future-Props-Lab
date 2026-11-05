import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrameExportDialog } from "@shared/ui/FrameExportDialog";
import type { FrameSnapshot } from "@shared/media/videoFrameExport";

const snapshotAt = (capturedAt: number): FrameSnapshot => ({
  blob: new Blob([String(capturedAt)], { type: "image/png" }),
  capturedAt,
  width: 1920,
  height: 1080,
});

describe("frame export dialog scrubber", () => {
  beforeEach(() => {
    let objectUrl = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:frame-${++objectUrl}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("loads the released time immediately and exports that selected frame", async () => {
    const loadSnapshot = vi.fn(async (time: number) => snapshotAt(time));
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <FrameExportDialog
        baseName="clip-frame"
        destination="保存到项目"
        initialTime={1.25}
        maxTime={10}
        step={0.001}
        loadSnapshot={loadSnapshot}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(await screen.findByAltText("当前导出视频帧预览")).toBeVisible();
    const scrubber = screen.getByRole("slider", {
      name: "导出视频帧时间点",
    });
    fireEvent.change(scrubber, { target: { value: "4.5" } });
    expect(screen.getByLabelText("视频帧输出文件名")).toHaveTextContent(
      "clip-frame_00-00-04-500.png",
    );
    expect(screen.getByRole("button", { name: "导出并保存" })).toBeDisabled();

    fireEvent.pointerUp(scrubber);
    await waitFor(() => expect(loadSnapshot).toHaveBeenCalledTimes(2));
    expect(loadSnapshot.mock.calls[1]?.[0]).toBe(4.5);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出并保存" })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "导出并保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const file = onSave.mock.calls[0]?.[0] as File;
    expect(file.name).toBe("clip-frame_00-00-04-500.png");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("debounces dragging, aborts an older preview, and retries failures", async () => {
    let pendingSignal: AbortSignal | undefined;
    const loadSnapshot = vi.fn((time: number, signal: AbortSignal) => {
      if (time === 2) {
        pendingSignal = signal;
        return new Promise<FrameSnapshot>(() => undefined);
      }
      if (time === 3 && loadSnapshot.mock.calls.length === 3)
        return Promise.reject(new Error("合成帧失败"));
      return Promise.resolve(snapshotAt(time));
    });
    render(
      <FrameExportDialog
        baseName="clip-frame"
        destination="保存到项目"
        initialTime={1}
        maxTime={10}
        step={0.001}
        loadSnapshot={loadSnapshot}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(await screen.findByAltText("当前导出视频帧预览")).toBeVisible();
    const scrubber = screen.getByRole("slider", {
      name: "导出视频帧时间点",
    });
    fireEvent.change(scrubber, { target: { value: "2" } });
    await waitFor(() => expect(loadSnapshot).toHaveBeenCalledTimes(2));
    fireEvent.change(scrubber, { target: { value: "3" } });
    expect(pendingSignal?.aborted).toBe(true);
    fireEvent.pointerUp(scrubber);

    expect(await screen.findByRole("alert")).toHaveTextContent("合成帧失败");
    fireEvent.click(screen.getByRole("button", { name: "重试此帧" }));
    await waitFor(() => expect(loadSnapshot).toHaveBeenCalledTimes(4));
    expect(await screen.findByAltText("当前导出视频帧预览")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出并保存" })).toBeEnabled(),
    );
  });
});
