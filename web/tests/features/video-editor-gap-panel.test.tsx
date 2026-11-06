import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorGapPanel } from "@features/video-editor/VideoEditorGapPanel";
import type { TimelineEditBuilder } from "@features/video-editor/timelineSaveQueue";
import {
  gapAsset,
  gapTimeline,
  gapTrack,
  gapClip,
} from "../helpers/video-editor-gaps";

const fixture = () => ({
  timeline: gapTimeline(),
  assets: [gapAsset()],
  canWrite: true,
  saving: false,
  commit: vi.fn(async (build: TimelineEditBuilder) => {
    build(gapTimeline());
  }),
  onLocate: vi.fn(),
  onClose: vi.fn(),
});
function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}
describe("gap inspection panel", () => {
  it("starts unselected, displays precise values, locates and resets selection on rescan", () => {
    const props = fixture();
    render(<VideoEditorGapPanel {...props} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(
      screen
        .getAllByRole("checkbox")
        .every((item) => item.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    expect(screen.getByText("49.707 毫秒 · 约 1.49 帧")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "定位空隙 00:01.000003" }),
    );
    expect(props.onLocate).toHaveBeenCalledWith(
      expect.objectContaining({ startUs: 1_000_003 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "全选显示项" }));
    expect(screen.getByRole("button", { name: "处理选中" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(screen.getByRole("button", { name: "处理选中" })).toBeDisabled();
  });
  it("all processing respects duration and track filters and excludes unavailable items", async () => {
    const props = fixture();
    props.timeline.document.tracks!.push(
      gapTrack("other", [
        gapClip("other-left", 0),
        gapClip("other-right", 1_070_003),
      ]),
    );
    props.commit = vi.fn(async (build) => {
      const edit = build(props.timeline);
      expect(edit.redo[0]).toMatchObject({
        type: "restoreClipStates",
        clips: [{ id: "left", durationUs: 1_049_710 }],
      });
    });
    render(<VideoEditorGapPanel {...props} />);
    choose("空隙时长筛选", "短空隙 ≤100 毫秒");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    choose("空隙轨道筛选", "v");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "处理全部显示项" }));
    await waitFor(() => expect(props.commit).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("已处理 1 处空隙");
  });
  it("invalidates selection on timeline or metadata updates, prevents duplicate processing", async () => {
    const props = fixture();
    const { rerender } = render(<VideoEditorGapPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "全选显示项" }));
    rerender(
      <VideoEditorGapPanel
        {...props}
        timeline={{ ...props.timeline, revision: 5 }}
      />,
    );
    expect(screen.getByRole("button", { name: "处理选中" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "全选显示项" }));
    rerender(
      <VideoEditorGapPanel {...props} assets={[gapAsset({ revision: 1 })]} />,
    );
    expect(screen.getByRole("button", { name: "处理选中" })).toBeDisabled();
    rerender(<VideoEditorGapPanel {...props} saving />);
    expect(
      screen.getByRole("button", { name: "处理全部显示项" }),
    ).toBeDisabled();
    expect(props.commit).not.toHaveBeenCalled();
  });
  it("permits read-only inspection and location, blocks all processing", () => {
    const props = fixture();
    render(<VideoEditorGapPanel {...props} canWrite={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "定位空隙 00:01.000003" }),
    );
    expect(props.onLocate).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "全选显示项" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "处理全部显示项" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeEnabled();
  });
  it("shows source capacity reasons and ripple alignment warning", () => {
    render(
      <VideoEditorGapPanel
        {...fixture()}
        assets={[gapAsset({ probe: { durationUs: 1_000_026 } })]}
      />,
    );
    expect(screen.getAllByText(/不可处理.*剩余长度不足/)).toHaveLength(2);
    choose("空隙处理方式", "前移后续片段，闭合空隙");
    expect(screen.getByText(/画面与它们的对齐会改变/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "处理全部显示项" }),
    ).toBeEnabled();
  });
  it("rechecks against the committed revision and stops stale results without writes", async () => {
    const props = fixture();
    props.commit = vi.fn(async (build) => {
      expect(build({ ...props.timeline, revision: 5 })).toEqual({
        redo: [],
        undo: [],
      });
    });
    render(<VideoEditorGapPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "处理全部显示项" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("未提交修改"),
    );
  });
  it("shows failed saves and blocks repeated clicks while the batch is pending", async () => {
    const props = fixture();
    let reject!: (error: Error) => void;
    props.commit = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    render(<VideoEditorGapPanel {...props} />);
    const button = screen.getByRole("button", { name: "处理全部显示项" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(props.commit).toHaveBeenCalledOnce();
    reject(new Error("409：保存已暂停"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("409：保存已暂停"),
    );
  });
  it("offers freeze as an explicit mode and freezes color gaps without uploading or moving anything", async () => {
    const props = fixture();
    props.timeline.document.tracks![0].clips!.forEach((clip) => {
      clip.kind = "color";
    });
    props.commit = vi.fn(async (build) => {
      const edit = build(props.timeline);
      expect(edit.redo).toHaveLength(2);
      expect(edit.redo[0]).toMatchObject({
        type: "addClip",
        clip: {
          kind: "color",
          timelineStartUs: 1_000_003,
          durationUs: 49_707,
          volume: 0,
          linkGroupId: null,
        },
      });
      expect(edit.undo.every((op) => op.type === "removeClip")).toBe(true);
    });
    render(<VideoEditorGapPanel {...props} />);
    choose("空隙处理方式", "定帧填补空隙，保持后续时序");
    fireEvent.click(screen.getByRole("button", { name: "处理全部显示项" }));
    await waitFor(() => expect(props.commit).toHaveBeenCalledOnce());
  });
});
