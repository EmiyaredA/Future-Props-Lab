import { useEffect, useRef, useState } from "react";
import { imageBlob } from "./api";
import { coverCrop } from "./imageCrop";
import type { SlideElement } from "./types";
export type CropSession = {
  ratio: number | null;
  base: SlideElement;
  draft: SlideElement;
  natural: { width: number; height: number };
};
export function useImageCrop(selectionKey = "") {
  const generation = useRef(0);
  useEffect(() => {
    const counter = generation;
    counter.current++;
    setSession(null);
    return () => {
      counter.current++;
    };
  }, [selectionKey]);
  const [session, setSession] = useState<CropSession | null>(null);
  return {
    session,
    cancel: () => {
      generation.current++;
      setSession(null);
    },
    begin: async (element: SlideElement) => {
      if (element.kind !== "image" || element.locked) return;
      const version = ++generation.current;
      const bitmap = await createImageBitmap(
        await imageBlob(element.asset_id!),
      );
      const natural = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (version !== generation.current) return;
      setSession({
        ratio: null,
        base: element,
        draft: {
          ...element,
          crop: coverCrop(
            natural.width,
            natural.height,
            element.width,
            element.height,
            element.crop,
          ),
        },
        natural,
      });
    },
    patch: (patch: Partial<SlideElement>) =>
      setSession((s) => (s ? { ...s, draft: { ...s.draft, ...patch } } : s)),
    preset: (ratio: number | null) =>
      setSession((s) => {
        if (!s) return s;
        if (!ratio) return { ...s, ratio: null };
        const width = Math.min(s.base.width, s.base.height * ratio),
          height = width / ratio,
          c = s.base.crop;
        const crop = coverCrop(
          s.natural.width,
          s.natural.height,
          width,
          height,
          c,
        );
        return {
          ...s,
          ratio,
          draft: {
            ...s.draft,
            width,
            height,
            x: s.base.x + (s.base.width - width) / 2,
            y: s.base.y + (s.base.height - height) / 2,
            crop,
          },
        };
      }),
  };
}
