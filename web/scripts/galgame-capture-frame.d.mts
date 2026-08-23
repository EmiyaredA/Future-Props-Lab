export type CaptureFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function mapCaptureFrame(
  frame: CaptureFrame | undefined,
  output: { width: number; height: number },
): CaptureFrame;

export function captureVideoFilter(
  frame: CaptureFrame | undefined,
  output: { width: number; height: number },
  fps: number,
  trimPrefix?: string,
): string;
