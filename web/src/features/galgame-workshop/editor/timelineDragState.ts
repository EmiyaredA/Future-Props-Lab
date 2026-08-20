import type { GalgameStoryFragment } from "@features/galgame-workshop/api";

export type TimelineDragState = {
  kind:
    | "cue"
    | "point"
    | "boundary"
    | "cue-start"
    | "cue-end"
    | "gap-start"
    | "gap-end"
    | "cg-range"
    | "cg-start"
    | "cg-end";
  itemId: string;
  startX: number;
  source: GalgameStoryFragment;
};
