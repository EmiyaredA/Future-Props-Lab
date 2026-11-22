export type H3Selection = { start: number; end: number };

const selector = "[data-prompt-source-start]";

function afterInvisibleTail(token: HTMLElement, offset: number) {
  const block = token.closest(".prompt-render-block");
  const tokens = [...(block?.querySelectorAll<HTMLElement>(selector) ?? [])];
  const remaining = tokens.slice(tokens.indexOf(token) + 1);
  const guard = block?.querySelector<HTMLElement>("[data-prompt-caret-end]");
  return guard &&
    remaining.every(
      (element) => !element.textContent?.replaceAll("\u200b", "").trim(),
    )
    ? Number(guard.dataset.promptSourceStart)
    : offset;
}

function sourcePoint(
  root: HTMLElement,
  node: Node,
  offset: number,
  end: boolean,
  caret = false,
) {
  const element = node instanceof Element ? node : node.parentElement;
  const token = element?.closest<HTMLElement>(selector);
  if (token && root.contains(token)) {
    const start = Number(token.dataset.promptSourceStart);
    const length = Number(token.dataset.promptSourceLength);
    if (token.dataset.promptAtomic === "true")
      return end
        ? caret
          ? afterInvisibleTail(token, start + length)
          : start + length
        : start;
    const range = document.createRange();
    range.selectNodeContents(token);
    range.setEnd(node, offset);
    const relative = Math.min(length, range.toString().length);
    return caret && relative === length
      ? afterInvisibleTail(token, start + relative)
      : start + relative;
  }
  const point = document.createRange();
  point.setStart(node, offset);
  point.collapse(true);
  const tokens = [...root.querySelectorAll<HTMLElement>(selector)];
  for (const candidate of tokens) {
    const range = document.createRange();
    range.selectNode(candidate);
    if (point.compareBoundaryPoints(Range.START_TO_START, range) <= 0)
      return Number(candidate.dataset.promptSourceStart);
  }
  const last = tokens.at(-1);
  return last
    ? Number(last.dataset.promptSourceStart) +
        Number(last.dataset.promptSourceLength)
    : 0;
}

export function h3Selection(root: HTMLElement): H3Selection | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  return h3SelectionRange(root, range);
}

export function h3SelectionRange(
  root: HTMLElement,
  range: Pick<
    Range,
    | "startContainer"
    | "startOffset"
    | "endContainer"
    | "endOffset"
    | "collapsed"
  >,
): H3Selection | undefined {
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return;
  if (range.collapsed) {
    const start = sourcePoint(
      root,
      range.startContainer,
      range.startOffset,
      true,
      true,
    );
    return { start, end: start };
  }
  return {
    start: sourcePoint(root, range.startContainer, range.startOffset, false),
    end: sourcePoint(root, range.endContainer, range.endOffset, true),
  };
}

export function restoreH3Caret(root: HTMLElement, offset: number) {
  const tokens = [...root.querySelectorAll<HTMLElement>(selector)];
  const range = document.createRange();
  for (const token of tokens) {
    const start = Number(token.dataset.promptSourceStart);
    const length = Number(token.dataset.promptSourceLength);
    if (offset < start || offset > start + length) continue;
    if (token.dataset.promptAtomic === "true") {
      if (offset <= start) range.setStartBefore(token);
      else range.setStartAfter(token);
    } else {
      const walker = document.createTreeWalker(token, NodeFilter.SHOW_TEXT);
      let remaining = offset - start;
      let text = walker.nextNode();
      while (text && remaining > (text.textContent?.length ?? 0)) {
        remaining -= text.textContent?.length ?? 0;
        text = walker.nextNode();
      }
      if (!text) continue;
      range.setStart(text, remaining);
    }
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    return;
  }
  range.selectNodeContents(root);
  range.collapse(offset === 0);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

export function expandH3Atoms(root: HTMLElement, selection: H3Selection) {
  const result = { ...selection };
  for (const token of root.querySelectorAll<HTMLElement>(
    `${selector}[data-prompt-atomic="true"]`,
  )) {
    const start = Number(token.dataset.promptSourceStart);
    const end = start + Number(token.dataset.promptSourceLength);
    if (result.start < end && result.end > start) {
      result.start = Math.min(result.start, start);
      result.end = Math.max(result.end, end);
    }
  }
  return result;
}
