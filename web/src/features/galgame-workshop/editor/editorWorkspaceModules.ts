import { lazy } from "react";
import {
  BookOpenText,
  GitBranch,
  Images,
  Palette,
  Settings2,
} from "lucide-react";
import { galgameQueryKeys } from "@features/galgame-workshop/queryKeys";
export const BlockInspector = lazy(() =>
  import("@features/galgame-workshop/editor/EditorInspectors").then(
    (module) => ({ default: module.BlockInspector }),
  ),
);
export const TimelineGapInspector = lazy(() =>
  import("@features/galgame-workshop/editor/EditorInspectors").then(
    (module) => ({ default: module.TimelineGapInspector }),
  ),
);
export const StoryTimelineEditor = lazy(() =>
  import("@features/galgame-workshop/editor/StoryTimelineEditor").then(
    (module) => ({ default: module.StoryTimelineEditor }),
  ),
);
export const StoryBlockEditor = lazy(() =>
  import("@features/galgame-workshop/editor/StoryBlockEditor").then(
    (module) => ({ default: module.StoryBlockEditor }),
  ),
);
export const StoryPlayer = lazy(() =>
  import("@features/galgame-workshop/editor/StoryPlayer").then((module) => ({
    default: module.StoryPlayer,
  })),
);
export const AssetCenter = lazy(() =>
  import("@features/galgame-workshop/editor/AssetCenter").then((module) => ({
    default: module.AssetCenter,
  })),
);
export const DialogueStyleInspector = lazy(() =>
  import("@features/galgame-workshop/editor/DialogueStyleInspector").then(
    (module) => ({ default: module.DialogueStyleInspector }),
  ),
);
export const NarrativeMapWorkspace = lazy(() =>
  import("@features/galgame-workshop/editor/NarrativeMapWorkspace").then(
    (module) => ({ default: module.NarrativeMapWorkspace }),
  ),
);
export const PersonalizationWorkspace = lazy(() =>
  import("@features/galgame-workshop/editor/ProjectWorkspaces").then(
    (module) => ({ default: module.PersonalizationWorkspace }),
  ),
);
export const ProjectSettingsWorkspace = lazy(() =>
  import("@features/galgame-workshop/editor/ProjectWorkspaces").then(
    (module) => ({ default: module.ProjectSettingsWorkspace }),
  ),
);
export const WORKSPACES = [
  { id: "script", label: "剧本", icon: BookOpenText },
  { id: "assets", label: "资产", icon: Images },
  { id: "narrative", label: "叙事地图", icon: GitBranch },
  { id: "personalization", label: "个性化", icon: Palette },
  { id: "settings", label: "设置", icon: Settings2 },
] as const;
export const STORY_KEY = galgameQueryKeys.story;
