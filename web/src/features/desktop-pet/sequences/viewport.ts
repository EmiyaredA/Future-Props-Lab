import type { PetViewportBounds } from "../whale-vendor/pet-core.js";
import type { FrameSequences } from "./types";

/** Fit the shared whole-frame canvas, never an individual cel's painted bounds. */
export function petViewportBounds(
  width: number,
  height: number,
  view: "center" | "floor",
  sequences: FrameSequences | null,
): PetViewportBounds {
  if (view === "center" && sequences && width > 0 && height > 0) {
    const [x, y, w, h] = sequences.modelBox;
    const pad = Math.min(8, width / 4, height / 4);
    const scale = Math.min(1.8, (width - 2 * pad) / w, (height - 2 * pad) / h);
    return {
      W: width,
      H: height,
      S: scale,
      centerX: width / 2 + (128 - x - w / 2) * scale,
      floorY: height / 2 + (256 - y - h / 2) * scale,
    };
  }
  const scale = Math.min(1.8, Math.min(width / 260, height / 320) * 1.25);
  return {
    W: width,
    H: height,
    S: scale,
    floorY: view === "center" ? height / 2 + 128 * scale : height - 8,
  };
}
