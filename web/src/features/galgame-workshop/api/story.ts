import { api, unwrap } from "@platform/api/client";
import type {
  GalgameStoryDocument,
  GalgameStoryProject,
  GeneratedGalgameStoryProject,
} from "./types";
import {
  normalizeStoryDocument,
  normalizeStoryProject,
} from "./storyNormalization";

export async function getGalgameStoryDocument(
  projectId: string,
): Promise<GalgameStoryDocument> {
  const response = await unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}/story", {
      params: { path: { project_id: projectId } },
    }),
  );
  return normalizeStoryDocument(response);
}

export async function putGalgameStoryDocument(
  projectId: string,
  document: GalgameStoryProject,
  expectedRevision: number,
) {
  const requestDocument = normalizeStoryProject(
    document,
  ) satisfies GeneratedGalgameStoryProject;
  const response = await unwrap(
    await api.PUT("/v1/galgame-workshop/projects/{project_id}/story", {
      params: { path: { project_id: projectId } },
      body: { document: requestDocument, expected_revision: expectedRevision },
    }),
  );
  return normalizeStoryDocument(response);
}

export async function getGalgameStoryReport(projectId: string) {
  return unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}/story/report", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function previewGalgamePortraitUpgrade(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function applyGalgamePortraitUpgrade(
  projectId: string,
  expectedStoryRevision: number,
) {
  const response = await unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/story/portrait-upgrade",
      {
        params: { path: { project_id: projectId } },
        body: { expectedStoryRevision },
      },
    ),
  );
  return normalizeStoryDocument(response);
}

export async function listGalgamePortraitSnapshots(projectId: string) {
  return unwrap(
    await api.GET(
      "/v1/galgame-workshop/projects/{project_id}/story/snapshots",
      { params: { path: { project_id: projectId } } },
    ),
  );
}

export async function restoreGalgamePortraitSnapshot(
  projectId: string,
  snapshotId: string,
  expectedStoryRevision: number,
) {
  const response = await unwrap(
    await api.POST(
      "/v1/galgame-workshop/projects/{project_id}/story/snapshots/{snapshot_id}/restore",
      {
        params: {
          path: { project_id: projectId, snapshot_id: snapshotId },
        },
        body: { expectedStoryRevision },
      },
    ),
  );
  return normalizeStoryDocument(response);
}
