import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";

export type PrevisScene = components["schemas"]["PrevisSceneOut"];
export type PrevisSceneInput = components["schemas"]["PrevisSceneCreate"];

const collection = "/v1/visual-workshop/projects/{project_id}/previs-scenes";
const item =
  "/v1/visual-workshop/projects/{project_id}/previs-scenes/{scene_id}";

export async function listPrevis(project: string, signal?: AbortSignal) {
  return unwrap(
    await api.GET(collection, {
      params: { path: { project_id: project } },
      signal,
    }),
  );
}

export async function createPrevis(project: string, body: PrevisSceneInput) {
  return unwrap(
    await api.POST(collection, {
      params: { path: { project_id: project } },
      body,
    }),
  );
}

export async function openPrevis(
  project: string,
  scene: string,
  signal?: AbortSignal,
) {
  return unwrap(
    await api.GET(item, {
      params: { path: { project_id: project, scene_id: scene } },
      signal,
    }),
  );
}

export async function savePrevis(
  project: string,
  scene: PrevisScene,
  body: PrevisSceneInput,
) {
  return unwrap(
    await api.PUT(item, {
      params: { path: { project_id: project, scene_id: scene.id } },
      body: { ...body, expected_revision: scene.revision },
    }),
  );
}

export async function deletePrevis(
  project: string,
  scene: Pick<PrevisScene, "id" | "revision">,
) {
  return unwrap(
    await api.DELETE(item, {
      params: {
        path: { project_id: project, scene_id: scene.id },
        query: { expected_revision: scene.revision },
      },
    }),
  );
}
