import type { ImportedAudioAnnotationSpeaker } from "./model";

export type SpeakerImportProject = {
  id: string;
  title: string;
  status?: string;
};

export interface SpeakerImportSource {
  listProjects(): Promise<SpeakerImportProject[]>;
  listSpeakers(projectId: string): Promise<ImportedAudioAnnotationSpeaker[]>;
}
