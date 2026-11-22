import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

type ScriptResponse = components["schemas"]["ScriptOut"];
type ScriptEpisode = Omit<components["schemas"]["ScriptEpisode"], "scenes"> & {
  scenes: ScriptScene[];
};
export type Script = Omit<ScriptResponse, "episodes"> & {
  episodes: ScriptEpisode[];
};

function normalizedScript(value: ScriptResponse): Script {
  return {
    ...value,
    episodes: (value.episodes ?? []).map((episode) => ({
      ...episode,
      scenes: episode.scenes ?? [],
    })),
  };
}
export type ScriptScene = components["schemas"]["ScriptScene"];
export type ScriptSource = components["schemas"]["ScriptSource"];
export type Card = components["schemas"]["CardOut"];
export type CardData = Partial<components["schemas"]["CardData"]> &
  Pick<components["schemas"]["CardData"], "title" | "kind">;
export type CardKind = Card["kind"];
export type ScriptSeed = { scene: ScriptScene; source: ScriptSource };

const script = "/v1/visual-workshop/projects/{project_id}/script";
const cards = "/v1/visual-workshop/projects/{project_id}/asset-cards";
const library = "/v1/visual-workshop/asset-cards";
const card = "/v1/visual-workshop/asset-cards/{card_id}";

export const scriptKey = (project: string) =>
  ["visual-script", project] as const;
export const cardsKey = ["visual-asset-cards"] as const;
export const projectCardsKey = (project: string) =>
  ["visual-project-cards", project] as const;
export type ReferenceImageInput =
  components["schemas"]["ReferenceImageRegistration"];
export type ReferenceImageResult =
  components["schemas"]["ReferenceImageRegistered"];

export async function listProjectCards(
  project_id: string,
  signal?: AbortSignal,
) {
  return unwrap(
    await api.GET(cards, { params: { path: { project_id } }, signal }),
  );
}

export async function registerReferenceImage(
  project_id: string,
  body: ReferenceImageInput,
) {
  return unwrap(
    await api.POST(
      "/v1/visual-workshop/projects/{project_id}/reference-images",
      { params: { path: { project_id } }, body },
    ),
  );
}

export async function getScript(project_id: string, signal?: AbortSignal) {
  return normalizedScript(
    await unwrap(
      await api.GET(script, { params: { path: { project_id } }, signal }),
    ),
  );
}

export async function saveScript(project_id: string, value: Script) {
  return normalizedScript(
    await unwrap(
      await api.PUT(script, {
        params: { path: { project_id } },
        body: { episodes: value.episodes, expected_revision: value.revision },
      }),
    ),
  );
}

export async function listCards(signal?: AbortSignal) {
  return unwrap(await api.GET(library, { signal }));
}

export async function createCard(
  project_id: string | undefined,
  value: CardData,
) {
  const body = {
    archived: false,
    design: "",
    ...value,
  };
  return unwrap(
    project_id
      ? await api.POST(cards, { params: { path: { project_id } }, body })
      : await api.POST(library, { body }),
  );
}

export async function saveCard(value: Card) {
  return unwrap(
    await api.PUT(card, {
      params: { path: { card_id: value.id } },
      body: {
        kind: value.kind,
        title: value.title,
        design: value.design,
        voice_asset_id: value.voice_asset_id,
        source: value.source,
        parent_id: value.parent_id,
        parent_asset_id: value.parent_asset_id,
        candidate_task_ids: value.candidate_task_ids,
        candidate_asset_ids: value.candidate_asset_ids,
        adopted_asset_id: value.adopted_asset_id,
        model_asset_key: value.model_asset_key,
        archived: value.archived,
        expected_revision: value.revision,
      },
    }),
  );
}

export async function generateCard(
  project_id: string,
  card_id: string,
  body: components["schemas"]["CardGenerationIn"],
) {
  return unwrap(
    await api.POST(
      "/v1/visual-workshop/projects/{project_id}/asset-cards/{card_id}/generations",
      {
        params: { path: { project_id, card_id } },
        body,
      },
    ),
  );
}
