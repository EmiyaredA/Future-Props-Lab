import type { GalgameStoryProject } from "@features/galgame-workshop/api";

export type VisualSelection = { kind: "scene" | "cg"; id: string };

export type VisualMenuState = {
  item: VisualSelection;
  trigger: HTMLButtonElement;
};

export type PickerTarget = {
  kind: "scene-layer" | "cg-variant";
  mode: "add" | "replace";
};

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function visualMenuPosition(
  trigger: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  menu: Pick<DOMRect, "height" | "width">,
  viewport: { height: number; width: number },
) {
  const margin = 8;
  const gap = 4;
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const maxTop = Math.max(margin, viewport.height - menu.height - margin);
  const right = Math.max(margin, trigger.right + gap);
  const left =
    right + menu.width <= viewport.width - margin
      ? right
      : clamp(trigger.left - menu.width - gap, margin, maxLeft);
  const below = trigger.bottom + gap;
  const above = trigger.top - menu.height - gap;
  const top =
    below + menu.height <= viewport.height - margin
      ? below
      : above >= margin
        ? above
        : clamp(trigger.top, margin, maxTop);
  return { left, top };
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
