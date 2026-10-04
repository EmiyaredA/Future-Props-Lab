// Editors of the same table document share a transport lane within this page.
// Revisions remain explicit: a second editor with stale input must resolve CAS.
const lanes = new Map<string, Promise<unknown>>();
export async function serializeTableSave<T>(
  document: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = lanes.get(document) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  lanes.set(document, next);
  try {
    return await next;
  } finally {
    if (lanes.get(document) === next) lanes.delete(document);
  }
}
