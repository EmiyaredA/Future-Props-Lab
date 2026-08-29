import type { GalgameStoryProject } from "@features/galgame-workshop/api";

export type VisualSelection = { kind: "scene" | "cg"; id: string };

export type VisualMenuState = {
  item: VisualSelection;
  left: number;
  top: number;
  trigger: HTMLButtonElement;
};

export type PickerTarget = {
  kind: "scene-layer" | "cg-variant";
  mode: "add" | "replace";
};

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function cleanLabel(filename: string, fallback: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || fallback;
}

export function sceneReferences(
  document: GalgameStoryProject,
  sceneId: string,
) {
  return (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap((fragment) =>
      (fragment.blocks ?? []).flatMap((block, index) =>
        block.type === "scene" && block.sceneId === sceneId
          ? [
              {
                chapter: chapter.title,
                fragmentId: fragment.id,
                fragment: fragment.title,
                blockId: block.id,
                index,
              },
            ]
          : [],
      ),
    ),
  );
}

export function cgReferences(document: GalgameStoryProject, cgId: string) {
  return (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap((fragment) =>
      (fragment.blocks ?? []).flatMap((block, index) =>
        block.type === "showCg" && block.cgId === cgId
          ? [
              {
                chapter: chapter.title,
                fragmentId: fragment.id,
                fragment: fragment.title,
                blockId: block.id,
                index,
                variantId: block.variantId,
              },
            ]
          : [],
      ),
    ),
  );
}

export function distanceAtPercent(percent: number) {
  const value = 0.1 * 10 ** ((clamp(percent, 0, 100) / 100) * 3);
  return value < 1 ? Math.round(value * 10) / 10 : Math.round(value * 2) / 2;
}
