export const DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH = 236;
export const MIN_KNOWLEDGE_SIDEBAR_WIDTH = 180;
export const MAX_KNOWLEDGE_SIDEBAR_WIDTH = 420;
export const KNOWLEDGE_SIDEBAR_WIDTH_KEY =
  "future_props_thought_knowledge_sidebar_width";

export function clampKnowledgeSidebarWidth(value: number) {
  return Math.max(
    MIN_KNOWLEDGE_SIDEBAR_WIDTH,
    Math.min(MAX_KNOWLEDGE_SIDEBAR_WIDTH, Math.round(value)),
  );
}

export function readKnowledgeSidebarWidth() {
  try {
    const raw = localStorage.getItem(KNOWLEDGE_SIDEBAR_WIDTH_KEY);
    if (!raw) return DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH;
    const parsed = Number(raw);
    return Number.isFinite(parsed)
      ? clampKnowledgeSidebarWidth(parsed)
      : DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_KNOWLEDGE_SIDEBAR_WIDTH;
  }
}

export function writeKnowledgeSidebarWidth(value: number) {
  try {
    localStorage.setItem(
      KNOWLEDGE_SIDEBAR_WIDTH_KEY,
      String(clampKnowledgeSidebarWidth(value)),
    );
  } catch {
    /* ignore quota / private mode */
  }
}
