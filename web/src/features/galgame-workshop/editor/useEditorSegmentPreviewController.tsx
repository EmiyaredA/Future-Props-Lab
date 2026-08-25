import { useState } from "react";
import type { EditorPageViewModel } from "@features/galgame-workshop/editor/editorViewModel";
import {
  createEditorFastPreviewSession,
  type EditorFastPreviewSession,
} from "@features/galgame-workshop/editor/editorFastPreviewSession";
import {
  EditorSegmentPreviewDialog,
  type SegmentPreviewSelection,
} from "@features/galgame-workshop/editor/EditorSegmentPreviewDialog";
import {
  defaultVideoClipRange,
  videoClipRangeError,
} from "@features/galgame-workshop/editor/videoExportRange";

export function useEditorSegmentPreviewController(model: EditorPageViewModel) {
  const [fastPreview, setFastPreview] = useState<EditorFastPreviewSession>();
  const [segmentPreviewOpen, setSegmentPreviewOpen] = useState(false);
  const [segmentSelection, setSegmentSelection] =
    useState<SegmentPreviewSelection>();
  const [videoExportSeed, setVideoExportSeed] =
    useState<SegmentPreviewSelection>();
  const ready = model.status === "ready" ? model : undefined;

  const openSegmentPreview = () => {
    if (!ready) return;
    const { playbackFollow, selectedFragment, timelinePreviewMs } = ready;
    const durationMs = selectedFragment?.timeline?.durationMs;
    if (!selectedFragment || durationMs == null) return;
    const playheadMs =
      playbackFollow?.fragmentId === selectedFragment.id
        ? playbackFollow.positionMs
        : (timelinePreviewMs ?? 0);
    setSegmentSelection((current) => {
      if (
        current?.fragmentId === selectedFragment.id &&
        !videoClipRangeError(current, durationMs)
      )
        return current;
      return {
        fragmentId: selectedFragment.id,
        ...defaultVideoClipRange(durationMs, playheadMs),
      };
    });
    setSegmentPreviewOpen(true);
  };

  const renderSegment = (
    range: NonNullable<EditorFastPreviewSession["playbackRange"]>,
  ) => {
    if (!ready) return;
    const selection = {
      fragmentId: range.fragmentId,
      startMs: range.startMs,
      endMs: range.endMs,
    };
    setSegmentSelection(selection);
    setVideoExportSeed(selection);
    setSegmentPreviewOpen(false);
    setFastPreview(undefined);
    ready.setPreviewMode("edit");
    ready.setVideoExportOpen(true);
  };

  const dialog = ready ? (
    <EditorSegmentPreviewDialog
      open={segmentPreviewOpen}
      fragment={ready.selectedFragment}
      selectedBlockIndex={ready.selectedIndex}
      selection={segmentSelection}
      renderDisabledReason={
        ready.conflict
          ? "存在版本冲突，解决后才能渲染"
          : ready.saveState === "saving"
            ? "故事仍在保存，保存完成后才能渲染"
            : ready.saveState !== "saved"
              ? "当前故事尚未成功保存"
              : undefined
      }
      onChange={setSegmentSelection}
      onClose={() => setSegmentPreviewOpen(false)}
      onPreview={() => {
        if (!segmentSelection) return;
        setSegmentPreviewOpen(false);
        setFastPreview(
          createEditorFastPreviewSession({
            document: ready.document,
            scope: "range",
            chapter: ready.chapter,
            selectedFragment: ready.selectedFragment,
            selectedIndex: ready.selectedIndex,
            playbackRange: {
              ...segmentSelection,
              loop: false,
              autoPlay: true,
            },
          }),
        );
      }}
      onRender={() => {
        if (segmentSelection)
          renderSegment({ ...segmentSelection, autoPlay: true });
      }}
    />
  ) : null;

  return {
    fastPreview,
    setFastPreview,
    openSegmentPreview,
    renderSegment,
    videoExportSeed,
    clearVideoExportSeed: () => setVideoExportSeed(undefined),
    dialog,
  };
}
