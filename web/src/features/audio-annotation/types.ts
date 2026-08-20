import type { components } from "@generated/api";

export type AudioAnnotationProject =
  components["schemas"]["AudioAnnotationProjectOut"];
export type AudioAnnotationDocument =
  components["schemas"]["AudioAnnotationDocumentOut"];
export type AudioAnnotationSpeaker =
  components["schemas"]["AudioAnnotationSpeaker"];
export type AudioAnnotationSegment =
  components["schemas"]["AudioAnnotationSegment"];
export type AudioAnnotationWaveform =
  components["schemas"]["AudioAnnotationWaveformOut"];

export type AnnotationSnapshot = Pick<
  AudioAnnotationDocument,
  "schema_version" | "speakers" | "segments"
>;

export type AnnotationProjectFile = AnnotationSnapshot & {
  kind: "future-props-audio-annotation";
  exported_at: string;
  project: {
    title: string;
    duration_ms: number;
    source: {
      asset_id: string;
      display_name: string;
      original_filename: string;
      mime_type: string;
      byte_size: number;
    };
  };
};
