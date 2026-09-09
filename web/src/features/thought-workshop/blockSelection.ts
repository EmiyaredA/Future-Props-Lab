export function isGutterPointer(
  proseRect: Pick<DOMRect, "left" | "right">,
  x: number,
) {
  return x < proseRect.left || x > proseRect.right;
}

function intersects(
  rect: DOMRect,
  box: { left: number; top: number; right: number; bottom: number },
) {
  return (
    rect.right >= box.left &&
    rect.left <= box.right &&
    rect.bottom >= box.top &&
    rect.top <= box.bottom
  );
}

export function findMarqueeTargets(
  prose: HTMLElement,
  startY: number,
  endY: number,
  box: { left: number; top: number; right: number; bottom: number },
) {
  const topLevel = Array.from(prose.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  const containingList = topLevel.find((node) => {
    if (!node.matches("ul,ol")) return false;
    const bounds = node.getBoundingClientRect();
    return (
      startY >= bounds.top &&
      startY <= bounds.bottom &&
      endY >= bounds.top &&
      endY <= bounds.bottom
    );
  });
  const candidates = containingList
    ? Array.from(containingList.querySelectorAll<HTMLElement>(":scope > li"))
    : topLevel;
  return candidates.filter((node) =>
    intersects(node.getBoundingClientRect(), box),
  );
}
