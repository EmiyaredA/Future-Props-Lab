import { useCallback, useEffect, useRef, useState } from "react";
import type { TransferProgress } from "./transfer";

/** Explicitly scoped to an action owner. Overlapping actions cannot clear each other. */
export function useTransferProgress() {
  const [progress, setProgress] = useState<TransferProgress>();
  const requests = useRef({ sequence: 0, mounted: true });
  useEffect(() => {
    const state = requests.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
      state.sequence++;
    };
  }, []);
  const run = useCallback(
    async <T>(
      operation: (onProgress: (value: TransferProgress) => void) => Promise<T>,
    ): Promise<T> => {
      const current = ++requests.current.sequence;
      if (requests.current.mounted) setProgress(undefined);
      try {
        return await operation((value) => {
          if (requests.current.mounted && requests.current.sequence === current)
            setProgress(value);
        });
      } finally {
        if (requests.current.mounted && requests.current.sequence === current)
          setProgress(undefined);
      }
    },
    [],
  );
  return { progress, run };
}
