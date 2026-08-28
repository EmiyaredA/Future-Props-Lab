import { api, unwrap } from "@platform/api/client";
import type {
  GalgameStoryDialoguePortrait,
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

export async function patchGalgameStoryDialogue(
  projectId: string,
  edit: {
    fragmentId: string;
    blockId: string;
    text: string;
    expressionId: string | null;
    portrait:
      | (Omit<GalgameStoryDialoguePortrait, "visible" | "distance"> & {
          visible?: GalgameStoryDialoguePortrait["visible"];
          distance?: GalgameStoryDialoguePortrait["distance"];
        })
      | null;
  },
  expectedRevision: number,
) {
  return unwrap(
    await api.PATCH(
      "/v1/galgame-workshop/projects/{project_id}/story/dialogue",
      {
        params: { path: { project_id: projectId } },
        body: {
          expected_revision: expectedRevision,
          fragmentId: edit.fragmentId,
          blockId: edit.blockId,
          text: edit.text,
          expressionId: edit.expressionId,
          portrait: edit.portrait
            ? {
                ...edit.portrait,
                visible: edit.portrait.visible ?? true,
                distance: edit.portrait.distance ?? "medium",
              }
            : null,
        },
      },
    ),
  );
}

export async function patchGalgameStoryStageExpression(
  projectId: string,
  edit: {
    fragmentId: string;
    blockId: string;
    characterId: string;
    expressionId: string | null;
  },
  expectedRevision: number,
) {
  return unwrap(
    await api.PATCH(
      "/v1/galgame-workshop/projects/{project_id}/story/stage-expression",
      {
        params: { path: { project_id: projectId } },
        body: {
          expected_revision: expectedRevision,
          fragmentId: edit.fragmentId,
          blockId: edit.blockId,
          characterId: edit.characterId,
          expressionId: edit.expressionId,
        },
      },
    ),
  );
}

export async function patchGalgameStoryEdits(
  projectId: string,
  edits: Array<
    | {
        type: "dialogue";
        fragmentId: string;
        blockId: string;
        text: string;
        expressionId: string | null;
        portrait:
          | (Omit<GalgameStoryDialoguePortrait, "visible" | "distance"> & {
              visible?: GalgameStoryDialoguePortrait["visible"];
              distance?: GalgameStoryDialoguePortrait["distance"];
            })
          | null;
      }
    | {
        type: "stageExpression";
        fragmentId: string;
        blockId: string;
        characterId: string;
        expressionId: string | null;
      }
  >,
  expectedRevision: number,
) {
  const response = await unwrap(
    await api.PATCH("/v1/galgame-workshop/projects/{project_id}/story/edits", {
      params: { path: { project_id: projectId } },
      body: {
        expected_revision: expectedRevision,
        edits: edits.map((edit) => {
          if (edit.type !== "dialogue") return edit;
          return {
            ...edit,
            portrait: edit.portrait
              ? {
                  ...edit.portrait,
                  visible: edit.portrait.visible ?? true,
                  distance: edit.portrait.distance ?? "medium",
                }
              : null,
          };
        }),
      },
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
