import type { SlideElement } from "../types";
export function pathData(
  path: NonNullable<SlideElement["path"]>,
  width: number,
  height: number,
) {
  const points = path.points.map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }));
  if (!points.length) return "";
  let value = `M${points[0].x},${points[0].y}`;
  if (path.smooth && points.length > 2) {
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      value += ` Q${a.x},${a.y} ${(a.x + b.x) / 2},${(a.y + b.y) / 2}`;
    }
    value += ` L${points.at(-1)!.x},${points.at(-1)!.y}`;
  } else
    value += points
      .slice(1)
      .map((p) => ` L${p.x},${p.y}`)
      .join("");
  return value + (path.closed ? " Z" : "");
}
