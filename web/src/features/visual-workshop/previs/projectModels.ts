import { fetchApiBlob, fetchApiJson } from "@platform/api/client";
import { getFiles, type ManagedFile } from "@features/files";
import type { ProjectSceneModel } from "../../../../vendor/toonflow/trumanHost";

export const modelMime = "model/gltf-binary";
export const projectModelsKey = (project: string) =>
  ["visual-project-models", project] as const;

export const projectModelPath = (assetId: string) =>
  `assets/project-models/${assetId}.glb`;

function sceneModel(file: ManagedFile): ProjectSceneModel {
  return {
    id: `project-model-${file.id}`,
    kind: "model",
    category: "本地",
    name: file.display_name.slice(0, 160),
    path: projectModelPath(file.id),
    bytes: file.byte_size,
    normalize: true,
  };
}

export async function getProjectModels(project?: string) {
  const result = await getFiles({
    projectId: project,
    mediaKind: "document",
    includeReferences: false,
  });
  return result.items
    .filter((item) => item.mime_type === modelMime)
    .map(sceneModel);
}

export async function uploadProjectModel(
  project: string,
  file: File,
  signal: AbortSignal,
) {
  const body = new FormData();
  body.set("upload", file);
  body.set("project_id", project);
  return sceneModel(
    await fetchApiJson<ManagedFile>("/v1/files", {
      method: "POST",
      body,
      signal,
    }),
  );
}

export async function readProjectModel(project: string, path?: string) {
  return (await readModelBlob(path, project)).arrayBuffer();
}

export async function readModelBlob(
  path?: string,
  project?: string,
  signal?: AbortSignal,
) {
  const id = /^assets\/project-models\/([a-f0-9-]{36})\.glb$/.exec(
    path ?? "",
  )?.[1];
  if (!id) throw new Error("当前场景没有有效的项目模型引用");
  const query = project ? `?project_id=${encodeURIComponent(project)}` : "";
  const blob = await fetchApiBlob(`/v1/files/${id}/content${query}`, {
    signal,
  });
  if (blob.type && blob.type !== modelMime)
    throw new Error("上传的素材不是 GLB 模型");
  return blob;
}
