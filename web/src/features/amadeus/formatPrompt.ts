import type { Context, Reference } from "./protocol";

export function formatAmadeusPrompt(
  prompt: string,
  contexts: Context[],
  references: Reference[],
) {
  const windows = contexts.map((item) => ({
    application: item.application,
    projectId: item.projectId,
    path: item.path,
    unsaved: item.unsaved,
    selection: item.selection,
  }));
  const selected = references.map((item) => ({
    name: item.name,
    application: item.application,
    value: item.value,
    source: item.source,
  }));
  return (
    `${prompt}\n\n[当前窗口] ${JSON.stringify(windows)}\n` +
    (selected.length ? `[手动引用] ${JSON.stringify(selected)} ` : "")
  );
}
