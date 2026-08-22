import type { ReactNode } from "react";
import type {
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { TimelinePreferences } from "@features/galgame-workshop/editor/timelinePreferences";

export interface StoryTimelineEditorProps {
  document: GalgameStoryProject;
  fragment: GalgameStoryFragment;
  selectedBlockId?: string;
  selectedGapId?: string;
  onSelectBlock: (blockId: string) => void;
  onSelectGap: (gapId: string) => void;
  onFragment: (fragment: GalgameStoryFragment) => void;
  onPreviewPosition: (milliseconds: number | null) => void;
  preferences: TimelinePreferences;
  onPreferencesChange: (preferences: TimelinePreferences) => void;
  onRequestAddMenu?: () => void;
  addControl?: ReactNode;
  readOnly?: boolean;
  followPositionMs?: number | null;
  estimated?: boolean;
}
