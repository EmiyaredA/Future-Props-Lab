import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type Storyboard = Omit<
  components["schemas"]["StoryboardOut"],
  "shots"
> & { shots: Shot[] };
export type Shot = Required<components["schemas"]["StoryboardShot"]>;
const path = "/v1/visual-workshop/projects/{project_id}/storyboard";
export const getStoryboard = async (project_id: string, signal?: AbortSignal) =>
  normalized(
    await unwrap(
      await api.GET(path, { params: { path: { project_id } }, signal }),
    ),
  );
export const saveStoryboard = async (
  project_id: string,
  document: Storyboard,
) =>
  normalized(
    await unwrap(
      await api.PUT(path, {
        params: { path: { project_id } },
        body: {
          expected_revision: document.revision,
          shots: document.shots,
        },
      }),
    ),
  );

function normalized(value: components["schemas"]["StoryboardOut"]): Storyboard {
  return {
    ...value,
    shots: (value.shots ?? []).map((shot) => ({
      ...shot,
      duration: shot.duration ?? null,
      source: shot.source ?? null,
      previs: shot.previs ?? null,
      image_node_id: shot.image_node_id ?? null,
      video_node_id: shot.video_node_id ?? null,
      origin_node_id: shot.origin_node_id ?? null,
      card_ids: shot.card_ids ?? [],
    })),
  };
}
