import { copySlide } from "../templates";
import type { Deck } from "../types";
export function removePages(deck: Deck, ids: string[]): Deck {
  const removed = new Set(ids),
    slides = deck.slides.filter((s) => !removed.has(s.id));
  if (!slides.length) throw new Error("文稿至少保留一页");
  return {
    ...deck,
    slides: slides.map((s) => ({
      ...s,
      elements: s.elements.map((e) =>
        e.link?.type === "slide" && removed.has(e.link.target)
          ? { ...e, link: null }
          : e,
      ),
    })),
  };
}
export function duplicatePages(deck: Deck, ids: string[]): Deck {
  const selected = new Set(ids),
    count = deck.slides.filter((s) => selected.has(s.id)).length;
  if (deck.slides.length + count > 100) throw new Error("文稿最多 100 页");
  return {
    ...deck,
    slides: deck.slides.flatMap((s) =>
      selected.has(s.id) ? [s, copySlide(s)] : [s],
    ),
  };
}
export function movePages(deck: Deck, ids: string[], index: number): Deck {
  const selected = new Set(ids),
    moving = deck.slides.filter((s) => selected.has(s.id)),
    rest = deck.slides.filter((s) => !selected.has(s.id));
  const target = Math.max(
    0,
    Math.min(
      rest.length,
      index -
        deck.slides.slice(0, index).filter((s) => selected.has(s.id)).length,
    ),
  );
  return {
    ...deck,
    slides: [...rest.slice(0, target), ...moving, ...rest.slice(target)],
  };
}
