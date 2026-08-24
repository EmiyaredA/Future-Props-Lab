import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type PublicWorkspaceProjection =
  components["schemas"]["PublicWorkspaceProjectionOut"];
export type PublicGalgameStory = components["schemas"]["PublicGalgameStoryOut"];

export const getPublicWorkspace = async () =>
  unwrap(await api.GET("/v1/public-workspace"));

export const getPublicGalgameStory = async (projectId: string) =>
  unwrap(
    await api.GET("/v1/public-workspace/galgame-projects/{project_id}/story", {
      params: { path: { project_id: projectId } },
    }),
  );
