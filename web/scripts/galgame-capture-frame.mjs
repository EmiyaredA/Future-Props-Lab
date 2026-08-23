export function mapCaptureFrame(frame, output) {
  const source = frame ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const even = (value) => Math.max(0, Math.round(value / 2) * 2);
  const width = Math.min(
    output.width,
    even((source.width / 1920) * output.width),
  );
  const height = Math.min(
    output.height,
    even((source.height / 1080) * output.height),
  );
  return {
    x: Math.min(output.width - width, even((source.x / 1920) * output.width)),
    y: Math.min(
      output.height - height,
      even((source.y / 1080) * output.height),
    ),
    width,
    height,
  };
}

export function captureVideoFilter(frame, output, fps, trimPrefix = "") {
  const capture = mapCaptureFrame(frame, output);
  const full =
    capture.x === 0 &&
    capture.y === 0 &&
    capture.width === output.width &&
    capture.height === output.height;
  return `${trimPrefix}fps=${fps},${
    full
      ? ""
      : `crop=${capture.width}:${capture.height}:${capture.x}:${capture.y},`
  }scale=${output.width}:${output.height}:flags=lanczos`;
}
