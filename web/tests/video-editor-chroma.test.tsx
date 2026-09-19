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
    fireEvent.click(screen.getByRole("button", { name: "选择自定义抠像颜色" }));
    fireEvent.change(screen.getByLabelText("自定义抠像颜色十六进制值"), {
      target: { value: "#0088EE" },
    });
    expect(commit).toHaveBeenLastCalledWith(
      [
        {
          type: "updateClip",
          clipId: "clip",
          patch: { chromaKey: expect.objectContaining({ color: "#0088EE" }) },
        },
      ],
      expect.any(Array),
    );
    expect(screen.getByRole("dialog", { name: "自定义抠像颜色选色器" })).toBeVisible();
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

  it("removes key color from a red edge even when red is its dominant channel", () => {
    const canvas = document.createElement("canvas");
    const pixels = new Uint8ClampedArray([
      0, 255, 0, 255, 100, 155, 0, 255, 200, 55, 0, 255,
      200, 55, 0, 255, 200, 55, 0, 255, 200, 55, 0, 255,
    ]);
    vi.spyOn(canvas, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: pixels }),
      putImageData: vi.fn(),
    } as never);
    paintChromaCanvas(canvas, canvas, 6, 1, {
      enabled: true,
      color: "#00ff00",
      similarity: 42,
      softness: 18,
      despill: 100,
    });
    expect(pixels[7]).toBeCloseTo(100, -1);
    expect(pixels[11]).toBeCloseTo(200, -1);
    expect(pixels[8]).toBeGreaterThan(250);
    expect(pixels[9]).toBeLessThan(3);
    expect([...pixels.slice(20, 24)]).toEqual([200, 55, 0, 255]);
  });
});
