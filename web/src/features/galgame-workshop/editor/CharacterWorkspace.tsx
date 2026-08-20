import { CharacterWorkspaceView } from "@features/galgame-workshop/editor/CharacterWorkspaceView";
import { useCharacterWorkspaceController } from "@features/galgame-workshop/editor/useCharacterWorkspaceController";

type CharacterWorkspaceProps = Parameters<
  typeof useCharacterWorkspaceController
>[0];

export function CharacterWorkspace(props: CharacterWorkspaceProps) {
  return (
    <CharacterWorkspaceView model={useCharacterWorkspaceController(props)} />
  );
}
