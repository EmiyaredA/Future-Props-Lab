import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import {
  normalizeCharacterStageSettings,
  type ResolvedCharacterStageSettings,
} from "@features/galgame-workshop/api/storyDefaults";

export {
  DEFAULT_CHARACTER_POSITION_PRESETS,
  DEFAULT_STORY_SETTINGS,
  normalizeCharacterStageSettings,
  type ResolvedCharacterStageSettings,
} from "@features/galgame-workshop/api/storyDefaults";

export function characterStageSettings(
  document: GalgameStoryProject,
  characterId?: string,
): ResolvedCharacterStageSettings {
  const override = characterId
    ? document.settings?.characterStageOverrides?.[characterId]
    : undefined;
  return normalizeCharacterStageSettings(
    override ?? document.settings?.characterStage,
  );
}
