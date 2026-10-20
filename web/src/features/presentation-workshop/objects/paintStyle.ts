import type { CSSProperties } from "react";
import type { Slide, SlideElement } from "../types";
export type Paint = NonNullable<Slide["background_style"]>;
export const defaultPaint: Paint = {
  type: "solid",
  color: "#FFFFFF",
  end_color: "#5474E5",
  angle: 90,
  asset_id: null,
  fit: "cover",
};
export function paintStyle(paint: Paint, url?: string | null): CSSProperties {
  if (paint.type === "solid") return { background: paint.color };
  if (paint.type === "linear")
    return {
      background: `linear-gradient(${paint.angle}deg,${paint.color},${paint.end_color})`,
    };
  if (paint.type === "radial")
    return {
      background: `radial-gradient(ellipse,${paint.color},${paint.end_color})`,
    };
  return {
    backgroundColor: paint.color,
    backgroundImage: url ? `url("${url}")` : undefined,
    backgroundPosition: "center",
    backgroundRepeat: paint.fit === "repeat" ? "repeat" : "no-repeat",
    backgroundSize: paint.fit === "repeat" ? "256px 256px" : paint.fit,
  };
}
export function shadowFilter(shadow: SlideElement["shadow"]) {
  if (!shadow) return undefined;
  return `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}${Math.round(
    shadow.opacity * 255,
  )
    .toString(16)
    .padStart(2, "0")})`;
}
