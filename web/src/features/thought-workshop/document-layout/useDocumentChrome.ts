import { useMemo, useState } from "react";

/** Page-owned presentation state; never part of the saved document. */
export type DocumentChrome = {
  toolsTarget: HTMLDivElement | null;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
};

export function useDocumentChrome() {
  const [toolsTarget, toolsRef] = useState<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(true);
  const chrome = useMemo(
    () => ({ toolsTarget, expanded, setExpanded }),
    [toolsTarget, expanded],
  );
  return { chrome, toolsRef };
}
