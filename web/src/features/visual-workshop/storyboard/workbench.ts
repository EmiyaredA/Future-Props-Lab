import type { ReactNode } from "react";
import type { Shot } from "./api";

/** Presentation slots owned by the storyboard editor, hosted by the workbench. */
export type StoryboardWorkbench = {
  sidebar: ReactNode;
  editor: ReactNode;
  output: ReactNode;
  selected?: Shot;
  count: number;
  search: string;
  onSearch: (value: string) => void;
  busy: boolean;
  dirty: boolean;
  leave: (action: () => void | Promise<void>) => void;
};
