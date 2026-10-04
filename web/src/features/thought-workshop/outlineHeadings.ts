import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type OutlineHeading = {
  position: number;
  text: string;
  level: number;
  depth: number;
  parent: number | null;
};

export function collectOutline(doc: ProseMirrorNode): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const ancestors: OutlineHeading[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== "heading") return;
    const text = node.textContent.replace(/\s+/g, " ").trim();
    if (!text) return;
    const level = Math.max(1, Math.min(6, Number(node.attrs.level) || 1));
    while (ancestors.length && ancestors.at(-1)!.level >= level)
      ancestors.pop();
    const heading = {
      position,
      text,
      level,
      depth: ancestors.length,
      parent: ancestors.at(-1)?.position ?? null,
    };
    headings.push(heading);
    ancestors.push(heading);
  });
  return headings;
}

/** The details node views ignore their own DOM attributes, so revelation stays UI-only. */
export function revealOutlineTarget(
  target: HTMLElement,
  restores: Map<HTMLElement, () => void>,
) {
  for (
    let parent = target.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent.dataset.type !== "details") continue;
    const content = parent.querySelector<HTMLElement>(
      ':scope > div > [data-type="detailsContent"]',
    );
    const toggle = parent.querySelector<HTMLButtonElement>(":scope > button");
    if (!content?.hidden || !toggle || restores.has(parent)) continue;
    const wrapper = parent;
    const wasOpen = wrapper.classList.contains("is-open");
    const expanded = toggle.getAttribute("aria-expanded");
    const restore = () => {
      content.hidden = true;
      wrapper.classList.toggle("is-open", wasOpen);
      if (expanded === null) toggle.removeAttribute("aria-expanded");
      else toggle.setAttribute("aria-expanded", expanded);
      toggle.removeEventListener("click", close, true);
      restores.delete(wrapper);
    };
    const close = (event: MouseEvent) => {
      // First close a temporary reveal without saving a contradictory open attribute.
      event.preventDefault();
      event.stopImmediatePropagation();
      restore();
    };
    restores.set(wrapper, restore);
    content.hidden = false;
    wrapper.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.addEventListener("click", close, true);
  }
}
