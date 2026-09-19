import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditorChromaInspector } from "@features/video-editor/VideoEditorChromaInspector";
import { paintChromaCanvas } from "@features/video-editor/chromaCanvas";
import type { VideoEditorClip } from "@features/video-editor/types";

const clip = {
  id: "clip",
  kind: "video",
  name: "绿幕",
  trackId: "v1",
  timelineStartUs: 0,
  durationUs: 1_000_000,
  assetId: "a",
  sourceInUs: 0,
} as VideoEditorClip;

describe("video editor chroma key", () => {
  it("saves enabled and custom-color changes through updateClip with undo", () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    render(<VideoEditorChromaInspector clip={clip} commit={commit} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "启用抠像" }));
    expect(commit).toHaveBeenCalledWith(
      [
        {
          type: "updateClip",
          clipId: "clip",
          patch: { chromaKey: expect.objectContaining({ enabled: true }) },
        },
      ],
      [{ type: "updateClip", clipId: "clip", patch: { chromaKey: null } }],
    );
    fireEvent.change(screen.getByLabelText("自定义抠像颜色"), {
      target: { value: "#0088ee" },
    });
    expect(commit).toHaveBeenLastCalledWith(
      [
        {
          type: "updateClip",
          clipId: "clip",
          patch: { chromaKey: expect.objectContaining({ color: "#0088ee" }) },
        },
      ],
      expect.any(Array),
    );
  });

  it("matches the server matte for green and keeps unrelated red", () => {
    const canvas = document.createElement("canvas");
    const pixels = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 255]);
    const putImageData = vi.fn();
    vi.spyOn(canvas, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: pixels }),
      putImageData,
    } as never);
    paintChromaCanvas(canvas, canvas, 2, 1, {
      enabled: true,
      color: "#00ff00",
      similarity: 42,
      softness: 18,
      despill: 30,
    });
    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBe(255);
    expect(putImageData).toHaveBeenCalled();
  });
});
