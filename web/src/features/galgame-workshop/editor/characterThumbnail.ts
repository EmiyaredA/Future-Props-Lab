import type { CSSProperties } from "react";
import type { GalgameStoryCharacterExpression } from "@features/galgame-workshop/api";

export function characterThumbnailCropStyle(
  expression?: GalgameStoryCharacterExpression,
): CSSProperties {
  const crop = expression?.thumbnailCrop ?? { x: 50, y: 25, scale: 1.8 };
  return {
    "--thumbnail-x": `${crop.x}%`,
    "--thumbnail-y": `${crop.y}%`,
    "--thumbnail-scale": crop.scale,
  } as CSSProperties;
}
