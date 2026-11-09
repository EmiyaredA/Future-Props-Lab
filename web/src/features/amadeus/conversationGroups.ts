import { APPLICATION_DEFINITIONS } from "@features/applications/definitions";
import { workshopProjects } from "./projectScope";
import type { Conversation } from "./protocol";

export function groupConversations(
  conversations: Conversation[],
  search: string,
  editingId?: string,
) {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      workshop?: { name: string; brandImage: string };
      items: Conversation[];
    }
  >();
  const query = search.trim().toLowerCase();
  const ordered = [...conversations].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );
  for (const conversation of ordered) {
    const projects = conversation.projects ?? [];
    if (
      conversation.id !== editingId &&
      ![conversation.title, ...projects.map((project) => project.title)].some(
        (title) => title.toLowerCase().includes(query),
      )
    )
      continue;

    const project = projects.length === 1 ? projects[0] : undefined;
    const id = project
      ? JSON.stringify([project.resource, project.id])
      : projects.length
        ? "multiple"
        : "unassigned";
    let group = groups.get(id);
    if (!group) {
      const app = workshopProjects.find(
        ({ resource }) => resource === project?.resource,
      )?.app;
      group = {
        id,
        name: project?.title ?? (projects.length ? "跨项目" : "未关联项目"),
        workshop: APPLICATION_DEFINITIONS.find(({ id }) => id === app),
        items: [],
      };
      groups.set(id, group);
    }
    group.items.push(conversation);
  }
  return [...groups.values()];
}
