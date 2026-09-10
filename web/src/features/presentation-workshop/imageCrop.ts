import type { SlideElement } from "./types";

/** Fit inside the requested source region, then trim symmetrically to fill the frame. */
export function coverCrop(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  crop: SlideElement["crop"],
): SlideElement["crop"] {
  const sourceWidth = 1 - crop.left - crop.right;
  const sourceHeight = 1 - crop.top - crop.bottom;
  const scale = Math.max(
    frameWidth / (imageWidth * sourceWidth),
    frameHeight / (imageHeight * sourceHeight),
  );
  const extraX = Math.max(
    0,
    (sourceWidth - frameWidth / (scale * imageWidth)) / 2,
  );
  const extraY = Math.max(
    0,
    (sourceHeight - frameHeight / (scale * imageHeight)) / 2,
  );
  return {
    left: crop.left + extraX,
    right: crop.right + extraX,
    top: crop.top + extraY,
    bottom: crop.bottom + extraY,
  };
}
