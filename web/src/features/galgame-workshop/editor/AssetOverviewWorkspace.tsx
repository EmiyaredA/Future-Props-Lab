import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import { useAssetOverviewController } from "@features/galgame-workshop/editor/assets/useAssetOverviewController";
import { AssetOverviewView } from "@features/galgame-workshop/editor/assets/AssetOverviewView";

export function AssetOverviewWorkspace(props: {
  projectId: string;
  document: GalgameStoryProject;
  onLocate: (
    chapterId: string | undefined,
    fragmentId: string,
    blockId: string,
  ) => void;
  onNotice: (message: string) => void;
  onRepairMissingAsset: (
    storyAssetId: string,
    replacementFileId: string,
  ) => Promise<boolean>;
}) {
  const controller = useAssetOverviewController(props);
  return <AssetOverviewView controller={controller} />;
}
