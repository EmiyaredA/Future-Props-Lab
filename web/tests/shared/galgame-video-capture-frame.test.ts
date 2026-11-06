import { describe, expect, it } from "vitest";
// The renderer helper is intentionally plain ESM so Node and FFmpeg orchestration
// can consume the exact same mapping without bundling browser code.
import {
  captureVideoFilter,
  mapCaptureFrame,
} from "../../scripts/galgame-capture-frame.mjs";

describe("Galgame video capture mapping", () => {
  it("keeps canonical coordinates for 1080p and maps them to 720p", () => {
    const frame = { x: 160, y: 90, width: 1600, height: 900 };
    expect(mapCaptureFrame(frame, { width: 1920, height: 1080 })).toEqual(
      frame,
    );
    expect(mapCaptureFrame(frame, { width: 1280, height: 720 })).toEqual({
      x: 106,
      y: 60,
      width: 1066,
      height: 600,
    });
  });

  it("places crop before Lanczos scale and keeps legacy full-frame requests", () => {
    expect(
      captureVideoFilter(
        { x: 160, y: 90, width: 1600, height: 900 },
        { width: 1920, height: 1080 },
        30,
      ),
    ).toBe("fps=30,crop=1600:900:160:90,scale=1920:1080:flags=lanczos");
    expect(
      captureVideoFilter(undefined, { width: 1280, height: 720 }, 30),
    ).toBe("fps=30,scale=1280:720:flags=lanczos");
  });
});
