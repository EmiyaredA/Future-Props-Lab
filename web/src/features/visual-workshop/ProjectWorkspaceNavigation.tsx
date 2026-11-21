import { useLayoutEffect } from "react";

export type WorkspaceLeave = (action: () => void | Promise<void>) => void;
export type WorkspaceEditorState = {
  busy: boolean;
  dirty: boolean;
  leave: WorkspaceLeave;
};

/** Editors keep their save rules; the persistent project header delegates to them. */
export function ProjectWorkspaceNavigation({
  busy,
  dirty = false,
  leave,
  onState,
}: WorkspaceEditorState & { onState: (state: WorkspaceEditorState) => void }) {
  useLayoutEffect(() => {
    onState({ busy, dirty, leave });
  }, [busy, dirty, leave, onState]);
  return null;
}
