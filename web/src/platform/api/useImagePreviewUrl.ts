import { useVisibleApiBlobUrl } from "./useVisibleApiBlobUrl";
import { imagePreviewSource, type ImageSize } from "@shared/lib/imageSources";

/** Image-only preview hook. Exports and pixel editing keep using the original path. */
export function useImagePreviewUrl(
  path: string | null | undefined,
  size: ImageSize = 640,
) {
  return useVisibleApiBlobUrl(path ? imagePreviewSource(path, size) : null);
}
