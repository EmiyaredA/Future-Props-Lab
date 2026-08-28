type Identified = { id: string };

export type ProjectCollection<T extends Identified> = { items: T[] };

export function prependProject<T extends Identified>(
  current: ProjectCollection<T> | undefined,
  project: T,
): ProjectCollection<T> {
  return { items: [project, ...(current?.items ?? [])] };
}

export function upsertProject<T extends Identified>(
  current: ProjectCollection<T> | undefined,
  project: T,
): ProjectCollection<T> {
  return {
    items: [
      project,
      ...(current?.items ?? []).filter((item) => item.id !== project.id),
    ],
  };
}

export function removeProject<T extends Identified>(
  current: ProjectCollection<T> | undefined,
  projectId: string,
): ProjectCollection<T> {
  return {
    items: (current?.items ?? []).filter((item) => item.id !== projectId),
  };
}
