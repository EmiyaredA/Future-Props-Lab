import type { components } from "@generated/api";
import type { Deck } from "../types";
export function issueText(
  issue: components["schemas"]["ConversionIssue"],
  deck: Deck,
): string {
  const index = deck.slides.findIndex((page) => page.id === issue.slide_id);
  if (index < 0) return issue.message;
  const page = deck.slides[index],
    elementIndex = page.elements.findIndex(
      (element) => element.id === issue.element_id,
    );
  const object =
    elementIndex < 0
      ? ""
      : ` · ${page.elements[elementIndex].name || `对象 ${elementIndex + 1}`}`;
  return `第 ${index + 1} 页${object}：${issue.message}`;
}
