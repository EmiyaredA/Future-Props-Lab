import { createContext, useContext, useLayoutEffect } from "react";

export const AssistantSplitMinimum = createContext<
  ((width: number | undefined) => void) | null
>(null);

export function useAssistantSplitMinimum(width: number) {
  const setMinimum = useContext(AssistantSplitMinimum);
  useLayoutEffect(() => {
    if (!setMinimum) return;
    setMinimum(width);
    return () => setMinimum(undefined);
  }, [setMinimum, width]);
}
