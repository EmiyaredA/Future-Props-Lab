import { api, unwrap } from "@platform/api/client";
import type { GalgameAsrSettings } from "./types";

export async function getGalgameAsrSettings(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/settings",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function patchGalgameAsrSettings(
  projectId: string,
  settings: GalgameAsrSettings,
  changes: {
    modelId?: string | null;
    defaultLanguage?: "auto" | "zh" | "ja";
    concurrency?: number;
  },
) {
  return unwrap(
    await api.PATCH(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/settings",
      {
        params: { path: { project_id: projectId } },
        body: { expectedRevision: settings.revision, ...changes },
      },
    ),
  );
}

export async function createGalgameTranscriptions(
  projectId: string,
  options: {
    assetIds?: string[];
    language?: "auto" | "zh" | "ja";
    force?: boolean;
  },
) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/transcriptions",
      {
        params: { path: { project_id: projectId } },
        body: { ...options, force: options.force ?? false },
      },
    ),
  );
}

export async function getGalgameTranscriptions(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/transcriptions",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function patchGalgameTranscript(
  projectId: string,
  assetId: string,
  expectedRevision: number,
  text: string,
  language?: "auto" | "zh" | "ja",
) {
  return unwrap(
    await api.PATCH(
      "/v1/galgame-workshop/projects/{project_id}/assets/{asset_id}/transcript",
      {
        params: { path: { project_id: projectId, asset_id: assetId } },
        body: { expectedRevision, text, language },
      },
    ),
  );
}

export async function matchGalgameVoiceDialogue(
  projectId: string,
  expectedStoryRevision: number,
  assetIds?: string[],
  blockIds?: string[],
) {
  return unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/assets/asr/match-dialogue",
      {
        params: { path: { project_id: projectId } },
        body: {
          expectedStoryRevision,
          assetIds,
          blockIds,
          minimumSimilarity: 0.72,
        },
      },
    ),
  );
}
