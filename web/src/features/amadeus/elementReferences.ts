import type {
  AssistantElement,
  AssistantElementSource,
} from "@platform/assistantElements";
import type { Reference } from "./protocol";

export const referenceLimit = 20;

export function elementReference(
  source: AssistantElementSource,
  element: AssistantElement,
): Reference {
  return {
    id: element.id,
    application: source.application,
    name: element.name.slice(0, 200),
    value: (element.value || "").slice(0, 2000),
    source: location.pathname,
    target: {
      project_resource: source.resource,
      project_id: source.projectId,
      element_kind: element.kind,
      element_id: element.id,
      parent_id: element.parentId,
      unsaved: element.unsaved ?? !!source.unsaved,
    },
  };
}

export function referenceKey({ target, source, id }: Reference) {
  return target
    ? JSON.stringify([
        target.project_resource,
        target.project_id,
        target.element_kind,
        target.element_id,
        target.parent_id ?? null,
      ])
    : JSON.stringify([source, id]);
}

export function mergeReferences(
  previous: Reference[],
  incoming: readonly Reference[],
) {
  const items = new Map(previous.map((ref) => [referenceKey(ref), ref]));
  for (const ref of incoming) {
    const key = referenceKey(ref);
    if (items.has(key) || items.size < referenceLimit) items.set(key, ref);
  }
  return [...items.values()];
}
