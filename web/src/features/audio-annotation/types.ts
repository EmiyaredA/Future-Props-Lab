import type { components } from "@generated/api";

export type AudioAnnotationProject =
  components["schemas"]["AudioAnnotationProjectOut"];
export type AudioAnnotationDocument =
  components["schemas"]["AudioAnnotationDocumentOut"];
export type AudioAnnotationSpeaker =
  components["schemas"]["AudioAnnotationSpeaker"];
export type AudioAnnotationSegment =
  components["schemas"]["AudioAnnotationSegment"];
export type AudioAnnotationLocalizedText =
  components["schemas"]["AudioAnnotationLocalizedText"];
export type AudioAnnotationWaveform =
  components["schemas"]["AudioAnnotationWaveformOut"];
export type AudioAnnotationTranscriptionOption =
  components["schemas"]["ModelTestTranscriptionOptionOut"];
export type AudioAnnotationSegmentTranscription =
  components["schemas"]["AudioAnnotationSegmentTranscriptionOut"];

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

export type PortableTranscriptionSegment = {
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
  translation?: string | null;
  speaker_candidates?: string[];
  is_overlap?: boolean;
};

export type PortableTranscriptionFile = {
  kind: "future-props-transcription";
  schema_version: "1.0" | "1.1";
  exported_at: string;
  source: {
    kind: "upload" | "library";
    asset_id: string | null;
    filename: string;
    mime_type: string;
    byte_size: number;
  };
  recognition: {
    task_id: string;
    provider_kind: "openai" | "senseaudio_asr" | "senseaudio_asr_pro";
    provider_name: string;
    model_slug: string;
    language: string;
    created_at: string;
    completed_at: string | null;
    text: string;
    segments: PortableTranscriptionSegment[];
    parameters?: components["schemas"]["ModelTestTranscriptionParametersOut"];
    result_detail?: components["schemas"]["ModelTestTranscriptionResultDetailOut"];
  };
};

export type AudioAnnotationImportFile =
  AnnotationProjectFile | PortableTranscriptionFile;
