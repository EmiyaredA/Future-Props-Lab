import { useMemo, useState } from "react";
import {
  maxSelectedProjects,
  projectFromContext,
  projectKey,
  workshopProjects,
  type ProjectReference,
} from "./projectScope";
import type { Context } from "./protocol";

type Choice = { manual: ProjectReference[]; excluded: string[] };

function readChoice(key: string): Choice | undefined {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(key) ?? "null",
    ) as Choice | null;
    if (!Array.isArray(saved?.manual) || !Array.isArray(saved.excluded))
      return undefined;
    return {
      manual: saved.manual
        .filter(
          (project) =>
            project &&
            typeof project.id === "string" &&
            typeof project.title === "string" &&
            workshopProjects.some(
              ({ resource }) => resource === project.resource,
            ),
        )
        .slice(0, maxSelectedProjects),
      excluded: saved.excluded.filter((key) => typeof key === "string"),
    };
  } catch {
    return undefined;
  }
}

export function useProjectSelection({
  owner,
  conversationId,
  pageContexts,
  lastRunContexts,
  standalone,
}: {
  owner: string;
  conversationId?: string;
  pageContexts: Context[];
  lastRunContexts: Context[];
  standalone: boolean;
}) {
  const key = `amadeus-projects:${owner}:${conversationId ?? "new"}`;
  const [override, setOverride] = useState<{ key: string; choice: Choice }>();
  const saved = useMemo(() => readChoice(key), [key]);
  const choice = override?.key === key ? override.choice : saved;

  const automatic = new Map<string, ProjectReference>();
  const manual = new Map<string, ProjectReference>();
  for (const context of lastRunContexts) {
    if (!context.projectResource) continue;
    const project = projectFromContext(context);
    if (project && (context.windowId === 0 || standalone))
      manual.set(projectKey(project), project);
  }
  if (choice) {
    manual.clear();
    for (const project of choice.manual)
      manual.set(projectKey(project), project);
  }
  for (const context of pageContexts) {
    const project = projectFromContext(context);
    if (project && !choice?.excluded.includes(projectKey(project)))
      automatic.set(projectKey(project), project);
  }

  const projects = [...new Map([...manual, ...automatic]).values()].slice(
    0,
    maxSelectedProjects,
  );
  const setProjects = (items: ProjectReference[]) => {
    const previous = new Set(projects.map(projectKey));
    const next = new Set(items.map(projectKey));
    const excluded = new Set(choice?.excluded);
    for (const id of automatic.keys()) {
      if (previous.has(id) && !next.has(id)) excluded.add(id);
    }
    for (const id of next) excluded.delete(id);
    const selection = {
      manual: items.filter((project) => {
        const id = projectKey(project);
        return manual.has(id) || !automatic.has(id);
      }),
      excluded: [...excluded].slice(-maxSelectedProjects),
    };
    setOverride({ key, choice: selection });
    try {
      sessionStorage.setItem(key, JSON.stringify(selection));
    } catch {
      // Selection remains available for the current page.
    }
  };
  return { projects, setProjects };
}
