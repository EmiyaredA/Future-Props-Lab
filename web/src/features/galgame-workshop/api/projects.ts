import { api, unwrap } from "@platform/api/client";
import type { GalgameWorkshopProject } from "./types";

export async function getGalgameWorkshopProjects() {
  return unwrap(await api.GET("/v1/galgame-workshop/projects"));
}

export async function getGalgameWorkshopProject(projectId: string) {
  return unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function createGalgameWorkshopProject(title: string) {
  return unwrap(
    await api.POST("/v1/galgame-workshop/projects", {
      body: { title },
    }),
  );
}

export async function patchGalgameWorkshopProject(
  project: GalgameWorkshopProject,
  changes: Partial<Pick<GalgameWorkshopProject, "title" | "status">>,
) {
  return unwrap(
    await api.PATCH("/v1/galgame-workshop/projects/{project_id}", {
      params: { path: { project_id: project.id } },
      body: { ...changes, expected_revision: project.revision },
    }),
  );
}

export async function deleteGalgameWorkshopProject(
  project: GalgameWorkshopProject,
) {
  return unwrap(
    await api.DELETE("/v1/galgame-workshop/projects/{project_id}", {
      params: {
        path: { project_id: project.id },
        query: { expected_revision: project.revision },
      },
    }),
  );
}
