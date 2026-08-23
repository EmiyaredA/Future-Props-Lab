import type { GalgameVideoExportCaptureFrame } from "@features/galgame-workshop/api";

export type CaptureFrame = Required<GalgameVideoExportCaptureFrame>;

export const FULL_CAPTURE_FRAME: CaptureFrame = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
};

const even = (value: number) => Math.round(value / 2) * 2;
const validWidth = (value: number) =>
  Math.min(1920, Math.max(320, Math.round(value / 16) * 16));

export function normalizeCaptureFrame(
  value: Partial<GalgameVideoExportCaptureFrame>,
): CaptureFrame {
  const width = validWidth(Number(value.width ?? 1920));
  const height = (width * 9) / 16;
  return {
    x: Math.min(1920 - width, Math.max(0, even(Number(value.x ?? 0)))),
    y: Math.min(1080 - height, Math.max(0, even(Number(value.y ?? 0)))),
    width,
    height,
  };
}
