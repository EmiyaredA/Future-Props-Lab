import type { Connection } from "./model";
import type { Point } from "./connectionGeometry";

// Keep the default font metrics in sync with connection_labels.py and its vectors.
export const labelFontSize = 16;
export const minLabelFontSize = 6;
export const maxLabelFontSize = 72;
export const labelLineHeight = 20;
export const labelMaxWidth = 240;
export const defaultLabelOffset = { x: 0, y: -16 };
const paddingX = 6,
  paddingY = 3;

function advance(char: string, fontSize = labelFontSize) {
  const code = char.codePointAt(0)!;
  if ((code >= 0x300 && code <= 0x36f) || code === 0x200d || code === 0xfe0f)
    return 0;
  return code >= 0x2e80 ? fontSize : fontSize / 2;
}

export function wrapLabel(text: string, fontSize = labelFontSize): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((paragraph) => {
      const lines: string[] = [];
      let line = "",
        width = 0;
      for (const char of paragraph) {
        const size = advance(char, fontSize);
        if (line && width + size > labelMaxWidth - paddingX * 2) {
          lines.push(line);
          line = "";
          width = 0;
        }
        line += char;
        width += size;
      }
      return [...lines, line];
    });
}

export function pointAt(points: Point[], position = 0.5): Point {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * position;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const ratio = lengths[i] ? remaining / lengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
      };
    }
    remaining -= lengths[i];
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}

export function labelLayout(
  points: Point[],
  edge: Pick<
    Connection,
    "label" | "label_position" | "label_offset" | "label_font_size"
  >,
) {
  if (!points.length || !edge.label?.trim()) return null;
  const fontSize = edge.label_font_size ?? labelFontSize;
  const lines = wrapLabel(edge.label, fontSize);
  const width = Math.max(
    24,
    ...lines.map(
      (line) =>
        Array.from(line).reduce(
          (sum, char) => sum + advance(char, fontSize),
          0,
        ) +
        paddingX * 2,
    ),
  );
  const height = lines.length * fontSize * 1.25 + paddingY * 2;
  const anchor = pointAt(points, edge.label_position ?? 0.5),
    offset = edge.label_offset ?? defaultLabelOffset;
  return {
    x: anchor.x + offset.x - width / 2,
    y: anchor.y + offset.y - height / 2,
    width,
    height,
    lines,
  };
}

/** Project a dragged label centre onto the path; ties keep the nearest old anchor. */
export function positionLabel(points: Point[], centre: Point, previous = 0.5) {
  const lengths = points
    .slice(1)
    .map((b, i) => Math.hypot(b.x - points[i].x, b.y - points[i].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let travelled = 0,
    best = { distance: Infinity, position: previous, point: points[0] };
  points.slice(1).forEach((b, i) => {
    const a = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = lengths[i];
    const ratio = length
      ? Math.max(
          0,
          Math.min(
            1,
            ((centre.x - a.x) * dx + (centre.y - a.y) * dy) / (length * length),
          ),
        )
      : 0;
    const point = { x: a.x + ratio * dx, y: a.y + ratio * dy };
    const distance = Math.hypot(centre.x - point.x, centre.y - point.y);
    const position = total ? (travelled + ratio * length) / total : 0.5;
    if (
      distance < best.distance - 1e-6 ||
      (Math.abs(distance - best.distance) < 1e-6 &&
        Math.abs(position - previous) < Math.abs(best.position - previous))
    )
      best = { distance, position, point };
    travelled += length;
  });
  return {
    label_position: best.position,
    label_offset: { x: centre.x - best.point.x, y: centre.y - best.point.y },
  };
}

/** Resize text with the label's top-left corner fixed, leaving its route intact. */
export function resizeLabel(points: Point[], edge: Connection, delta: Point) {
  const box = labelLayout(points, edge);
  if (!box) return null;
  const ratio =
    1 +
    (delta.x * box.width + delta.y * box.height) /
      (box.width * box.width + box.height * box.height);
  const fontSize = Math.max(
    minLabelFontSize,
    Math.min(
      maxLabelFontSize,
      Math.round((edge.label_font_size ?? labelFontSize) * ratio * 2) / 2,
    ),
  );
  const resized = labelLayout(points, { ...edge, label_font_size: fontSize })!;
  return {
    label_font_size: fontSize,
    ...positionLabel(
      points,
      { x: box.x + resized.width / 2, y: box.y + resized.height / 2 },
      edge.label_position ?? 0.5,
    ),
  };
}
