import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type GalgameWorkshopProject =
  components["schemas"]["GalgameWorkshopProjectOut"];
export type GalgameWorkshopProjectStatus = GalgameWorkshopProject["status"];
export type GalgameStoryDocument =
  components["schemas"]["GalgameStoryDocumentOut"];
export type GalgameStoryProject = components["schemas"]["GalgameStoryProject"];
export type GalgameStoryCharacter =
  components["schemas"]["GalgameStoryCharacter"];
export type GalgameStoryCharacterExpression =
  components["schemas"]["GalgameStoryCharacterExpression"];
export type GalgameStoryAsset = components["schemas"]["GalgameStoryAsset"];
export type GalgameProjectAsset =
  components["schemas"]["GalgameProjectAssetOut"];
export type GalgameStoryScene = components["schemas"]["GalgameStoryScene"];
export type GalgameStorySceneBackground =
  components["schemas"]["GalgameStorySceneBackground"];
export type GalgameStoryChapter = components["schemas"]["GalgameStoryChapter"];
export type GalgameStoryFragment =
  components["schemas"]["GalgameStoryFragment"];
export type GalgameStoryBlock = NonNullable<
  GalgameStoryFragment["blocks"]
>[number];
export type GalgameStoryBranchBlock =
  components["schemas"]["GalgameStoryBranchBlock"];
export type GalgameStoryRouteReport =
  components["schemas"]["GalgameStoryRouteReportOut"];

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

export async function getGalgameStoryDocument(projectId: string) {
  return unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}/story", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function putGalgameStoryDocument(
  projectId: string,
  document: GalgameStoryProject,
  expectedRevision: number,
) {
  return unwrap(
    await api.PUT("/v1/galgame-workshop/projects/{project_id}/story", {
      params: { path: { project_id: projectId } },
      body: { document, expected_revision: expectedRevision },
    }),
  );
}

export async function getGalgameStoryReport(projectId: string) {
  return unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}/story/report", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function getGalgameProjectAssets(projectId: string, query = "") {
  return unwrap(
    await api.GET("/v1/galgame-workshop/projects/{project_id}/assets", {
      params: { path: { project_id: projectId }, query: { query } },
    }),
  );
}

export async function uploadGalgameProjectAsset(projectId: string, file: File) {
  return unwrap(
    await api.POST("/v1/galgame-workshop/projects/{project_id}/assets", {
      params: { path: { project_id: projectId } },
      body: { upload: file as unknown as string },
      bodySerializer(body) {
        const form = new FormData();
        form.set("upload", body.upload as unknown as File);
        return form;
      },
    }),
  );
}

export async function deleteGalgameProjectAsset(
  projectId: string,
  asset: GalgameProjectAsset,
) {
  return unwrap(
    await api.DELETE(
      "/v1/galgame-workshop/projects/{project_id}/assets/{asset_id}",
      {
        params: {
          path: { project_id: projectId, asset_id: asset.id },
          query: { expected_revision: asset.revision },
        },
      },
    ),
  );
}
