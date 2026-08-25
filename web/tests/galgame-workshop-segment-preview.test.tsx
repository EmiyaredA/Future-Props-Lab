import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { GalgameStoryFragment } from "@features/galgame-workshop/api";
import { EditorFastPreviewRunMenu } from "@features/galgame-workshop/editor/EditorFastPreviewOverlay";
import { EditorSegmentPreviewDialog } from "@features/galgame-workshop/editor/EditorSegmentPreviewDialog";
import type { EditorPageViewModel } from "@features/galgame-workshop/editor/editorViewModel";

const fragment: GalgameStoryFragment = {
  id: "middle",
  title: "故事中段",
  timeline: { durationMs: 60_000 },
  blocks: [
    {
      id: "line-one",
      type: "narration",
      text: "需要微调的对白",
      startMs: 20_000,
      endMs: 24_500,
    },
  ],
};

test("edits a middle range, uses the selected block, and launches preview", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const onPreview = vi.fn();
  render(
    <EditorSegmentPreviewDialog
      open
      fragment={fragment}
      selectedBlockIndex={0}
      selection={{ fragmentId: "middle", startMs: 15_000, endMs: 25_000 }}
      onChange={onChange}
      onClose={vi.fn()}
      onPreview={onPreview}
      onRender={vi.fn()}
    />,
  );

  expect(screen.getByRole("dialog", { name: "预演时间区间" })).toBeVisible();
  expect(screen.getByLabelText("开始时间")).toHaveValue("00:15.000");
  expect(screen.getByLabelText("结束时间")).toHaveValue("00:25.000");

  await user.click(screen.getByRole("button", { name: "使用当前 Block" }));
  expect(onChange).toHaveBeenCalledWith({
    fragmentId: "middle",
    startMs: 20_000,
    endMs: 24_500,
  });

  fireEvent.change(screen.getByLabelText("快速试片开始位置"), {
    target: { value: "18000" },
  });
  expect(onChange).toHaveBeenCalledWith({
    fragmentId: "middle",
    startMs: 18_000,
    endMs: 25_000,
  });
  await user.click(screen.getByRole("button", { name: "开始区间预演" }));
  expect(onPreview).toHaveBeenCalledOnce();
});

test("keeps preview available for an unsaved draft but blocks MP4 rendering", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <EditorSegmentPreviewDialog
      open
      fragment={fragment}
      selectedBlockIndex={0}
      selection={{ fragmentId: "middle", startMs: 20_000, endMs: 24_500 }}
      renderDisabledReason="故事仍在保存，保存完成后才能渲染"
      onChange={vi.fn()}
      onClose={onClose}
      onPreview={vi.fn()}
      onRender={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "开始区间预演" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "渲染此区间" })).toBeDisabled();
  expect(screen.getByText("故事仍在保存，保存完成后才能渲染")).toBeVisible();

  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});

test("disables range preview for a fragment without a timeline", () => {
  render(
    <EditorSegmentPreviewDialog
      open
      fragment={{ id: "plain", title: "普通片段", blocks: [] }}
      onChange={vi.fn()}
      onClose={vi.fn()}
      onPreview={vi.fn()}
      onRender={vi.fn()}
    />,
  );

  expect(
    screen.getByText("当前 Fragment 没有时间轴，无法使用区间预演。"),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "开始区间预演" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "渲染此区间" })).toBeDisabled();
});

test("adds range preview to the Run menu only for timed fragments", async () => {
  const user = userEvent.setup();
  const onConfigureRange = vi.fn();
  const chapter = {
    id: "chapter",
    title: "章节",
    order: 1,
    entryFragmentId: fragment.id,
    fragments: [fragment],
  };
  const model = {
    status: "ready",
    document: {
      schemaVersion: "1.4",
      synopsis: "",
      characters: [],
      scenes: [],
      cgs: [],
      variables: [],
      assets: [],
      chapters: [chapter],
    },
    chapter,
    selectedFragment: fragment,
    selectedBlock: fragment.blocks?.[0],
    selectedIndex: 0,
  } as unknown as Extract<EditorPageViewModel, { status: "ready" }>;
  render(
    <EditorFastPreviewRunMenu
      model={model}
      onLaunch={vi.fn()}
      onConfigureRange={onConfigureRange}
    />,
  );

  await user.click(screen.getByLabelText("打开运行菜单"));
  await user.click(screen.getByRole("button", { name: "预演时间区间" }));
  expect(onConfigureRange).toHaveBeenCalledOnce();
});
