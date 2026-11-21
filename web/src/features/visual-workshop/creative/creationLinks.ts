import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
export type CreationLinks = components["schemas"]["CreationLinksOut"];
const path = "/v1/visual-workshop/projects/{project_id}/creation-links";
export const creationLinksKey = (project: string) =>
  ["visual-creation-links", project] as const;
export async function getCreationLinks(
  project_id: string,
  signal?: AbortSignal,
) {
  return unwrap(
    await api.GET(path, { params: { path: { project_id } }, signal }),
  );
}
export async function saveCreationLinks(
  project_id: string,
  value: CreationLinks,
) {
  return unwrap(
    await api.PUT(path, {
      params: { path: { project_id } },
      body: {
        scenes: value.scenes ?? [],
        objects: value.objects ?? [],
        expected_revision: value.revision,
      },
    }),
  );
}
