import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import type { AudioRole } from "@features/galgame-workshop/editor/model";
import { useSoundWorkspaceController } from "@features/galgame-workshop/editor/audio/useSoundWorkspaceController";
import { SoundWorkspaceView } from "@features/galgame-workshop/editor/audio/SoundWorkspaceView";

export function SoundWorkspace(props: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onCommitDocument: (document: GalgameStoryProject) => Promise<boolean>;
  onLocate: (fragmentId: string, blockId: string) => void;
  onCharacter: (characterId: string) => void;
  onNotice: (message: string) => void;
  initialRole?: AudioRole;
  storyRevision: number;
}) {
  const controller = useSoundWorkspaceController(props);
  return <SoundWorkspaceView controller={controller} />;
}
