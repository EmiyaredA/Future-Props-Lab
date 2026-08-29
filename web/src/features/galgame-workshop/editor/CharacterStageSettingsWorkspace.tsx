import type {
  GalgameProjectAsset,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { useCharacterStageController } from "@features/galgame-workshop/editor/characters/useCharacterStageController";
import { CharacterStageSettingsView } from "@features/galgame-workshop/editor/characters/CharacterStageSettingsView";

export function CharacterStageSettingsWorkspace(props: {
  document: GalgameStoryProject;
  selectedCharacterId?: string;
  scopeId: "global" | string;
  projectAssets: GalgameProjectAsset[];
  portraitUpgradePreview?: {
    items: Array<{
      characterId: string;
      expressionId: string;
      status: string;
      currentHeightPercent?: number | null;
      targetHeightPercent?: number | null;
    }>;
  };
  portraitUpgradePending: boolean;
  onScopeId: (scopeId: "global" | string) => void;
  onDocument: (document: GalgameStoryProject) => void;
  onCommitDocument: (document: GalgameStoryProject) => Promise<boolean>;
  onNotice: (message: string) => void;
  onPreviewPortraitUpgrade: () => void;
  onApplyPortraitUpgrade: () => void;
}) {
  const controller = useCharacterStageController(props);
  return <CharacterStageSettingsView controller={controller} />;
}
