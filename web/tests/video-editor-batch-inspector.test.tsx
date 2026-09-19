import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorBatchInspector } from "@features/video-editor/VideoEditorBatchInspector";
import {
  buildBatchClipOperations,
  mixedValues,
} from "@features/video-editor/batchClipPatch";
import type { VideoEditorClip } from "@features/video-editor/types";

const base = {
  trackId: "v1",
  timelineStartUs: 0,
  durationUs: 1_000_000,
  sourceInUs: 0,
  volume: 1,
  muted: false,
  fitMode: "cover" as const,
  transform: {
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    anchor: "center" as const,
    brightness: 1,
  },
};

const video = (id: string, patch: Partial<VideoEditorClip> = {}) =>
  ({
    ...base,
    id,
    kind: "video",
    name: id,
    assetId: `asset-${id}`,
    ...patch,
  }) as VideoEditorClip;

const audio = (id: string, patch: Partial<VideoEditorClip> = {}) =>
  ({
    ...base,
    id,
    kind: "audio",
    name: id,
    assetId: `asset-${id}`,
    ...patch,
  }) as VideoEditorClip;

const text = (id: string) =>
  ({
    ...base,
    id,
    kind: "text",
    name: id,
    text: "hello",
  }) as VideoEditorClip;

describe("batchClipPatch", () => {
  it("reports mixed values when selections disagree", () => {
    expect(mixedValues([1, 1, 1])).toEqual({ mixed: false, value: 1 });
    expect(mixedValues([1, 0.5])).toEqual({ mixed: true });
  });

  it("sets a fixed volume on audio and video only", () => {
    const result = buildBatchClipOperations(
      [video("v1", { volume: 0.5 }), audio("a1", { volume: 2 }), text("t1")],
      { audio: { mode: "set", volume: 0.8 } },
    );
    expect(result.applied).toBe(2);
    expect(result.skipped).toEqual([
      { name: "t1", reason: "不支持音量或静音" },
    ]);
    expect(result.redo).toEqual([
      {
        type: "updateClip",
        clipId: "v1",
        patch: { volume: 0.8 },
      },
      {
        type: "updateClip",
        clipId: "a1",
        patch: { volume: 0.8 },
      },
    ]);
    expect(result.undo).toEqual([
      { type: "updateClip", clipId: "v1", patch: { volume: 0.5 } },
      { type: "updateClip", clipId: "a1", patch: { volume: 2 } },
    ]);
  });

  it("applies relative volume per clip without clobbering transform", () => {
    const result = buildBatchClipOperations(
      [
        video("v1", { volume: 0.5, transform: { ...base.transform, scaleX: 2 } }),
        video("v2", { volume: 1.2 }),
      ],
      { audio: { mode: "delta", delta: 0.3 } },
    );
    expect(result.redo).toEqual([
      { type: "updateClip", clipId: "v1", patch: { volume: 0.8 } },
      { type: "updateClip", clipId: "v2", patch: { volume: 1.5 } },
    ]);
    expect(result.redo[0].patch).not.toHaveProperty("transform");
  });

  it("merges dirty transform fields while preserving other transform values", () => {
    const result = buildBatchClipOperations(
      [
        video("v1", {
          transform: { ...base.transform, x: 100, scaleX: 1.5, opacity: 0.4 },
        }),
        video("v2", {
          transform: { ...base.transform, x: 200, scaleX: 0.5, opacity: 0.9 },
        }),
      ],
      { visual: { transform: { scaleX: 1.2, scaleY: 1.2 } } },
    );
    expect(result.redo).toHaveLength(2);
    expect(result.redo[0].patch.transform).toMatchObject({
      x: 100,
      scaleX: 1.2,
      scaleY: 1.2,
      opacity: 0.4,
    });
    expect(result.redo[1].patch.transform).toMatchObject({
      x: 200,
      scaleX: 1.2,
      scaleY: 1.2,
      opacity: 0.9,
    });
  });

  it("skips audio clips when only visual fitMode is requested", () => {
    const result = buildBatchClipOperations(
      [video("v1"), audio("a1")],
      { visual: { fitMode: "contain" } },
    );
    expect(result.applied).toBe(1);
    expect(result.skipped[0]).toEqual({
      name: "a1",
      reason: "不支持画面适配",
    });
  });

  it("merges dirty chroma fields without wiping untouched parameters", () => {
    const result = buildBatchClipOperations(
      [
        video("v1", {
          chromaKey: {
            enabled: true,
            color: "#00ff00",
            similarity: 40,
            softness: 10,
            despill: 20,
          },
        }),
        video("v2", {
          chromaKey: {
            enabled: true,
            color: "#0000ff",
            similarity: 50,
            softness: 30,
            despill: 60,
          },
        }),
        audio("a1"),
      ],
      { chroma: { similarity: 65 } },
    );
    expect(result.applied).toBe(2);
    expect(result.skipped[0]).toEqual({
      name: "a1",
      reason: "不支持抠像",
    });
    expect(result.redo[0].patch.chromaKey).toMatchObject({
      enabled: true,
      color: "#00ff00",
      similarity: 65,
      softness: 10,
      despill: 20,
    });
    expect(result.redo[1].patch.chromaKey).toMatchObject({
      enabled: true,
      color: "#0000ff",
      similarity: 65,
      softness: 30,
      despill: 60,
    });
    expect(result.undo[0].patch).toEqual({
      chromaKey: {
        enabled: true,
        color: "#00ff00",
        similarity: 40,
        softness: 10,
        despill: 20,
      },
    });
  });

  it("applies named green-basic chroma together with volume in one batch", () => {
    const result = buildBatchClipOperations(
      [video("v1", { volume: 1 }), audio("a1", { volume: 1 })],
      {
        audio: { mode: "set", volume: 0.5 },
        chroma: {
          enabled: true,
          color: "#00ff00",
          similarity: 42,
          softness: 18,
          despill: 30,
        },
      },
    );
    expect(result.applied).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(result.redo).toEqual(
      expect.arrayContaining([
        {
          type: "updateClip",
          clipId: "v1",
          patch: {
            volume: 0.5,
            chromaKey: {
              enabled: true,
              color: "#00ff00",
              similarity: 42,
              softness: 18,
              despill: 30,
            },
          },
        },
        {
          type: "updateClip",
          clipId: "a1",
          patch: { volume: 0.5 },
        },
      ]),
    );
  });
});

describe("VideoEditorBatchInspector", () => {
  it("shows multi-select header and applies fixed volume through applyPatch", async () => {
    const applyPatch = vi.fn().mockResolvedValue({
      redo: [],
      undo: [],
      applied: 2,
      skipped: [],
      truncated: false,
    });
    render(
      <VideoEditorBatchInspector
        clips={[video("v1", { volume: 0.4 }), video("v2", { volume: 1 })]}
        applyPatch={applyPatch}
      />,
    );
    expect(screen.getByText("已选择 2 个片段")).toBeVisible();
    expect(screen.getByPlaceholderText("混合")).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "设置为固定值" }));
    fireEvent.change(screen.getByLabelText("音量"), {
      target: { value: "0.6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用到 2 个片段" }));
    expect(applyPatch).toHaveBeenCalledWith({
      audio: { mode: "set", volume: 0.6 },
    });
    expect(await screen.findByText("已应用到 2 个片段")).toBeVisible();
  });

  it("does not submit untouched transform when only volume changes", async () => {
    const applyPatch = vi.fn().mockResolvedValue({
      redo: [],
      undo: [],
      applied: 2,
      skipped: [{ name: "t1", reason: "不支持音量或静音" }],
      truncated: false,
    });
    render(
      <VideoEditorBatchInspector
        clips={[video("v1"), audio("a1"), text("t1")]}
        applyPatch={applyPatch}
      />,
    );
    fireEvent.change(screen.getByLabelText("音量"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用到 3 个片段" }));
    expect(applyPatch).toHaveBeenCalledWith({
      audio: { mode: "set", volume: 1.5 },
    });
    expect(await screen.findByText(/跳过 1 个片段/)).toBeVisible();
  });

  it("applies a named chroma preset through applyPatch", async () => {
    const applyPatch = vi.fn().mockResolvedValue({
      redo: [],
      undo: [],
      applied: 2,
      skipped: [],
      truncated: false,
    });
    render(
      <VideoEditorBatchInspector
        clips={[video("v1"), video("v2")]}
        applyPatch={applyPatch}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "高容差绿幕" }));
    fireEvent.click(screen.getByRole("button", { name: "应用到 2 个片段" }));
    expect(applyPatch).toHaveBeenCalledWith({
      chroma: {
        enabled: true,
        color: "#00ff00",
        similarity: 65,
        softness: 25,
        despill: 40,
      },
    });
    expect(await screen.findByText("已应用到 2 个片段")).toBeVisible();
  });
});
