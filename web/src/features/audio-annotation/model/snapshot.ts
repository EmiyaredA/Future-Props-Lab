import type { AnnotationSnapshot, AudioAnnotationDocument } from "../types";

export function annotationSnapshot(
  document: AudioAnnotationDocument,
): AnnotationSnapshot {
  return {
    schema_version: "1.0",
    speakers: document.speakers,
    custom_emotions: document.custom_emotions ?? [],
    segments: document.segments,
  };
}
