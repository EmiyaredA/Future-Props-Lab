import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
import type {
  AnnotationSnapshot,
  AudioAnnotationProject,
  AudioAnnotationWaveform,
} from "@features/audio-annotation/types";

export async function listAudioAnnotationProjects(query = "") {
  return unwrap(
    await api.GET("/v1/audio-annotation/projects", {
      params: { query: { query } },
    }),
  );
}

export async function getAudioAnnotationProject(projectId: string) {
  return unwrap(
    await api.GET("/v1/audio-annotation/projects/{project_id}", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function createAudioAnnotationProject(
  title: string,
  assetId: string,
) {
  return unwrap(
    await api.POST("/v1/audio-annotation/projects", {
      body: { title, asset_id: assetId },
    }),
  );
}

export async function importAudioAnnotationProject(
  title: string,
  assetId: string,
  document: AnnotationSnapshot,
) {
  return unwrap(
    await api.POST("/v1/audio-annotation/imports", {
      body: { title, asset_id: assetId, ...document },
    }),
  );
}

export async function renameAudioAnnotationProject(
  project: AudioAnnotationProject,
  title: string,
) {
  return unwrap(
    await api.PATCH("/v1/audio-annotation/projects/{project_id}", {
      params: { path: { project_id: project.id } },
      body: { expected_revision: project.revision, title },
    }),
  );
}

export async function deleteAudioAnnotationProject(
  project: AudioAnnotationProject,
) {
  return unwrap(
    await api.DELETE("/v1/audio-annotation/projects/{project_id}", {
      params: {
        path: { project_id: project.id },
        query: { expected_revision: project.revision },
      },
    }),
  );
}

export async function getAudioAnnotationDocument(projectId: string) {
  return unwrap(
    await api.GET("/v1/audio-annotation/projects/{project_id}/document", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function putAudioAnnotationDocument(
  projectId: string,
  expectedRevision: number,
  document: AnnotationSnapshot,
) {
  return unwrap(
    await api.PUT("/v1/audio-annotation/projects/{project_id}/document", {
      params: { path: { project_id: projectId } },
      body: { expected_revision: expectedRevision, ...document },
    }),
  );
}

export async function getAudioAnnotationWaveform(projectId: string) {
  return unwrap(
    await api.GET("/v1/audio-annotation/projects/{project_id}/waveform", {
      params: { path: { project_id: projectId } },
    }),
  );
}

export async function putAudioAnnotationWaveform(
  projectId: string,
  waveform: AudioAnnotationWaveform,
  peaks: number[][],
) {
  return unwrap(
    await api.PUT("/v1/audio-annotation/projects/{project_id}/waveform", {
      params: { path: { project_id: projectId } },
      body: {
        expected_revision: waveform.revision,
        duration_ms: waveform.duration_ms,
        peaks,
      },
    }),
  );
}

export type AudioAnnotationImportBody =
  components["schemas"]["AudioAnnotationImportIn"];
