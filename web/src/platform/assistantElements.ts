import { createContext, useContext, useLayoutEffect, useRef } from "react";
import type { components } from "@generated/api";

export type ElementTarget = components["schemas"]["ElementTarget"];
export type AssistantElement = {
  id: string;
  kind: ElementTarget["element_kind"];
  name: string;
  value?: string;
  parentId?: string;
  unsaved?: boolean;
};

export type AssistantElementSource = {
  resource: ElementTarget["project_resource"];
  projectId: string;
  application: string;
  unsaved?: boolean;
  selected: () => readonly AssistantElement[];
  resolve: (
    id: string,
    kind?: string,
    parentId?: string,
  ) => AssistantElement | undefined;
  hitTest?: (event: MouseEvent) => AssistantElement | undefined;
  locate?: (target: ElementTarget) => boolean | "failed";
};

type ReadSource = () => AssistantElementSource;
export type RegisterAssistantElements = (read: ReadSource) => () => void;
export const AssistantElements =
  createContext<RegisterAssistantElements | null>(null);

export function useAssistantElementRegistration() {
  return useContext(AssistantElements);
}

export function useAssistantElements(
  source: AssistantElementSource | undefined,
) {
  const register = useAssistantElementRegistration();
  const current = useRef(source);
  useLayoutEffect(() => {
    current.current = source;
  }, [source]);
  const { projectId, resource } = source ?? {};
  useLayoutEffect(() => {
    if (projectId && resource) return register?.(() => current.current!);
  }, [register, projectId, resource]);
}

export function assistantElementSource(
  scope: Omit<AssistantElementSource, "selected" | "resolve">,
  elements: readonly AssistantElement[],
  selectedIds: readonly string[],
): AssistantElementSource {
  return {
    ...scope,
    selected: () =>
      selectedIds.flatMap(
        (id) => elements.find((item) => item.id === id) ?? [],
      ),
    resolve: (id, kind, parentId) =>
      elements.find(
        (item) =>
          item.id === id &&
          (!kind || item.kind === kind) &&
          (!parentId || item.parentId === parentId),
      ),
  };
}
