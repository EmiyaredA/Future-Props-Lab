import {
  getGalgameStoryDocument,
  getGalgameWorkshopProjects,
} from "@features/galgame-workshop";
import type { SpeakerImportSource } from "@features/audio-annotation/speakerImportSource";

export const galgameSpeakerImportSource: SpeakerImportSource = {
  async listProjects() {
    const result = await getGalgameWorkshopProjects();
    return result.items.map(({ id, title, status }) => ({ id, title, status }));
  },
  async listSpeakers(projectId) {
    const result = await getGalgameStoryDocument(projectId);
    return (result.document.characters ?? []).map((character) => ({
      id: character.id,
      name: character.name,
      color: character.themeColor,
    }));
  },
};
