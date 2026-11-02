import { createUploadTransfer } from "@platform/api/transfer";
import { type TransferOptions } from "@platform/api/transfer";
import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type LocalModel = components["schemas"]["LocalModelOut"];
export type InferenceTask = components["schemas"]["InferenceTaskOut"];
export type InferenceAsset = components["schemas"]["InferenceAssetOut"];
export async function getLocalModels() {
  return unwrap(await api.GET("/v1/local-models"));
}
export async function localModelAction(
  model: LocalModel,
  action: components["schemas"]["LocalModelActionIn"]["action"],
) {
  return unwrap(
    await api.POST("/v1/platform/local-models/{model_id}/actions", {
      params: { path: { model_id: model.id } },
      body: {
        request_id: crypto.randomUUID(),
        expected_revision: model.revision,
        action,
      },
    }),
  );
}
export async function attachLocalModel(
  model_id: string,
  expected_catalog_revision: number,
) {
  return unwrap(
    await api.POST("/v1/local-models/attach", {
      body: { model_id, expected_catalog_revision },
    }),
  );
}
export async function getInferenceOptions() {
  return unwrap(await api.GET("/v1/model-inference/options"));
}
export async function getInferenceTasks() {
  return unwrap(await api.GET("/v1/model-inference/tasks"));
}
export async function uploadInferenceAudio(
  file: File,
  transfer: TransferOptions = {},
) {
  const uploadTransfer = createUploadTransfer(transfer.onProgress);

  return unwrap(
    await api.POST("/v1/model-inference/assets", {
      fetch: uploadTransfer.fetch,
      body: { upload: file as unknown as string },
      bodySerializer: () => {
        const data = new FormData();
        data.append("upload", file);
        return uploadTransfer.capture(data);
      },
    }),
  );
}
export async function deleteInferenceAudio(asset_id: string) {
  return unwrap(
    await api.DELETE("/v1/model-inference/assets/{asset_id}", {
      params: { path: { asset_id } },
    }),
  );
}
export async function createSpeechTask(
  model_id: string,
  text: string,
  language: string,
  reference: InferenceAsset,
  reference_text: string,
) {
  return unwrap(
    await api.POST("/v1/model-inference/tasks", {
      body: {
        request_id: crypto.randomUUID(),
        model_id,
        kind: "speech_synthesis",
        asset_ids: [reference.id],
        parameters: {
          text,
          language,
          reference_text,
          reference_asset_id: reference.id,
        },
      },
    }),
  );
}
export async function saveSpeechTask(task_id: string) {
  return unwrap(
    await api.POST("/v1/model-inference/tasks/{task_id}/save-to-library", {
      params: { path: { task_id } },
    }),
  );
}
export async function importInferenceAudio(asset_id: string) {
  return unwrap(
    await api.POST("/v1/model-inference/assets/import", { body: { asset_id } }),
  );
}
