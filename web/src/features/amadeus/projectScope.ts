import { fetchApiJson } from "@platform/api/client";
import type { Context } from "./protocol";

export const workshopProjects = [
  {
    resource: "visual",
    app: "visual-workshop",
    title: "视觉创作工坊",
    list: "list_projects",
  },
  {
    resource: "thought",
    app: "thought-workshop",
    title: "思绪工坊",
    list: "knowledge_bases",
  },
  {
    resource: "presentation",
    app: "presentation-workshop",
    title: "演示工坊",
    list: "list_projects",
    paginated: true,
  },
  {
    resource: "galgame",
    app: "galgame-workshop",
    title: "Galgame 工坊",
    list: "list_projects",
  },
  {
    resource: "video",
    app: "video-editor",
    title: "视频剪辑工坊",
    list: "list_projects",
  },
  {
    resource: "motion_compositor",
    app: "motion-compositor",
    title: "特效制作工坊",
    list: "list_projects",
  },
  {
    resource: "annotation",
    app: "audio-annotation",
    title: "录音标注工坊",
    list: "list_projects",
  },
  {
    resource: "director",
    app: "director-desk",
    title: "导演台",
    list: "list_projects",
    paginated: true,
  },
  {
    resource: "interview",
    app: "interview-assistant",
    title: "面试助手",
    list: "list_interview_rooms",
  },
] as const;

type Workshop = (typeof workshopProjects)[number];
export type ProjectReference = {
  resource: Workshop["resource"];
  id: string;
  title: string;
};
export const projectKey = (project: ProjectReference) =>
  `${project.resource}:${project.id}`;
export const maxSelectedProjects = 20;

export function projectFromContext(
  context: Context,
): ProjectReference | undefined {
  const workshop = workshopProjects.find((item) =>
    context.projectResource
      ? item.resource === context.projectResource
      : context.path?.split("/")[2] === item.app,
  );
  if (workshop && typeof context.projectId === "string" && context.projectId)
    return {
      resource: workshop.resource,
      id: context.projectId,
      title:
        typeof context.title === "string" && context.title.trim()
          ? context.title
          : context.projectId,
    };
}

function projectContext(project: ProjectReference, owner: string): Context {
  const workshop = workshopProjects.find(
    (item) => item.resource === project.resource,
  )!;
  return {
    windowId: 0,
    projectId: project.id,
    projectResource: project.resource,
    title: project.title,
    application: workshop.title,
    focused: false,
    userId: owner,
    accountId: owner,
  };
}

export function selectedProjectContexts(
  page: Context[],
  projects: ProjectReference[],
  owner: string,
) {
  const contextByProject = new Map<string, Context>();
  const otherContexts = page.filter((context) => {
    const project = projectFromContext(context);
    if (!project) return true;
    contextByProject.set(projectKey(project), context);
    return false;
  });
  return [
    ...otherContexts,
    ...projects.map((project) => ({
      ...projectContext(project, owner),
      ...contextByProject.get(projectKey(project)),
      projectResource: project.resource,
    })),
  ];
}

export async function listWorkshopProjects(
  workshop: Workshop,
  signal: AbortSignal,
) {
  type Row = { id: string; title: string };
  const projects: ProjectReference[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { result } = await fetchApiJson<{
      result: Row[] | { items: Row[]; total?: number };
    }>("/v1/amadeus/operations/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: `${workshop.resource}.${workshop.list}`,
        arguments:
          "paginated" in workshop ? { query: { offset, limit: pageSize } } : {},
      }),
      signal,
    });
    const items = Array.isArray(result) ? result : result.items;
    projects.push(
      ...items.map(({ id, title }) => ({
        id,
        title,
        resource: workshop.resource,
      })),
    );
    if (
      Array.isArray(result) ||
      !items.length ||
      result.total === undefined ||
      projects.length >= result.total
    )
      return projects;
  }
}
