import {
  transformPoint,
  handlePoints,
  type ClipTransform,
  type TransformGeometry,
  type TransformHandle,
} from "./transformModel";
import type { usePreviewTransform } from "./usePreviewTransform";
import "./video-editor-transform.css";

const labels = {
  nw: "左上等比缩放",
  n: "顶部拉伸",
  ne: "右上等比缩放",
  e: "右侧拉伸",
  se: "右下等比缩放",
  s: "底部拉伸",
  sw: "左下等比缩放",
  w: "左侧拉伸",
  rotate: "旋转画面",
};
export function VideoEditorTransformBox({
  transform,
  geometry,
  canvasWidth,
  canvasHeight,
  control,
  compareSplit = false,
}: {
  transform: ClipTransform;
  geometry: TransformGeometry;
  canvasWidth: number;
  canvasHeight: number;
  control: ReturnType<typeof usePreviewTransform>;
  compareSplit?: boolean;
}) {
  if (!control.eligible && !control.pending) return null;
  const { width, height } = control.bounds;
  if (!width || !height) return null;
  const screenPoint = (point: { x: number; y: number }) => {
    const world = transformPoint(point, transform, geometry);
    return {
      x: (world.x * width) / canvasWidth,
      y: (world.y * height) / canvasHeight,
    };
  };
  const corners = [
    handlePoints.nw,
    handlePoints.ne,
    handlePoints.se,
    handlePoints.sw,
  ].map(screenPoint);
  const top = screenPoint(handlePoints.n);
  const angle = (transform.rotation * Math.PI) / 180;
  const rotation = {
    x: top.x + Math.sin(angle) * 24,
    y: top.y - Math.cos(angle) * 24,
  };
  const handlers = (handle: TransformHandle) => ({
    onPointerDown: control.onPointerDown(handle),
    onPointerMove: control.onPointerMove,
    onPointerUp: control.onPointerUp,
    onPointerCancel: control.onPointerCancel,
    onLostPointerCapture: control.onLostPointerCapture,
    onKeyDown: control.onKeyDown,
  });
  return (
    <div
      className="ve-transform-overlay"
      role="group"
      aria-label="画面变换操作框"
    >
      <svg
        className="ve-transform-outline"
        width={width}
        height={height}
        aria-hidden="true"
      >
        <polygon
          points={corners.map((point) => `${point.x},${point.y}`).join(" ")}
        />
        <line x1={top.x} y1={top.y} x2={rotation.x} y2={rotation.y} />
      </svg>
      <button
        type="button"
        className="ve-transform-move"
        aria-label="移动画面"
        disabled={control.pending}
        style={{
          pointerEvents: compareSplit ? "none" : undefined,
          clipPath: `polygon(${corners.map((point) => `${(point.x / width) * 100}% ${(point.y / height) * 100}%`).join(", ")})`,
        }}
        {...handlers("move")}
      />
      {(
        [...Object.entries(handlePoints), ["rotate", rotation]] as [
          keyof typeof labels,
          { x: number; y: number },
        ][]
      ).map(([handle, point]) => {
        const position = handle === "rotate" ? point : screenPoint(point);
        if (
          position.x < -8 ||
          position.y < -28 ||
          position.x > width + 8 ||
          position.y > height + 8
        )
          return null;
        return (
          <button
            key={handle}
            type="button"
            className={`ve-transform-handle is-${handle}`}
            aria-label={labels[handle]}
            title={
              handle === "rotate" ? "旋转画面；Shift 吸附 15°" : labels[handle]
            }
            disabled={control.pending}
            style={{ left: position.x, top: position.y }}
            {...handlers(handle)}
          />
        );
      })}
    </div>
  );
}
