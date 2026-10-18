import type { Draft, Slide } from "./types";

export type HistoryLocation = {
  slideId: string;
  slideIndex: number;
  selected: string[];
};
export type HistoryEntry = {
  before: Draft;
  after: Draft;
  beforeLocation: HistoryLocation;
  afterLocation: HistoryLocation;
};

/** Resolve against the restored document, never against stale editor state. */
export function historyLocation(
  draft: Draft,
  preferred: HistoryLocation,
): HistoryLocation {
  const slides = draft.document.slides;
  const slide =
    slides.find((s) => s.id === preferred.slideId) ??
    slides[Math.min(preferred.slideIndex, slides.length - 1)];
  return {
    slideId: slide.id,
    slideIndex: slides.indexOf(slide),
    selected: preferred.selected.filter((id) =>
      slide.elements.some((e) => e.id === id),
    ),
  };
}

export function historyEntry(
  before: Draft,
  after: Draft,
  context?: HistoryLocation,
): HistoryEntry {
  const oldSlides = before.document.slides;
  const newSlides = after.document.slides;
  const added = newSlides.find(
    (s) => !oldSlides.some((old) => old.id === s.id),
  );
  const removed = oldSlides.find(
    (s) => !newSlides.some((next) => next.id === s.id),
  );
  const changed = newSlides.find((s) => {
    const old = oldSlides.find((old) => old.id === s.id);
    return old && JSON.stringify(old) !== JSON.stringify(s);
  });
  const affected = added ?? removed ?? changed;
  const preferred = affected
    ? {
        slideId: affected.id,
        slideIndex: (added ? newSlides : oldSlides).findIndex(
          (s) => s.id === affected.id,
        ),
        selected: context?.slideId === affected.id ? [...context.selected] : [],
      }
    : (context ?? { slideId: oldSlides[0].id, slideIndex: 0, selected: [] });
  const beforeLocation = historyLocation(before, preferred);
  const afterLocation = historyLocation(after, preferred);
  const old = oldSlides.find((s) => s.id === preferred.slideId);
  const next = newSlides.find((s) => s.id === preferred.slideId);
  if (old && next) {
    const changedElements = (page: Slide, other: Slide) =>
      page.elements
        .filter((e) => {
          const match = other.elements.find((item) => item.id === e.id);
          return !match || JSON.stringify(match) !== JSON.stringify(e);
        })
        .map((e) => e.id);
    if (!beforeLocation.selected.length)
      beforeLocation.selected = changedElements(old, next);
    if (!afterLocation.selected.length)
      afterLocation.selected = changedElements(next, old);
  }
  return { before, after, beforeLocation, afterLocation };
}
