import { useEffect, useRef, useState } from "react";
import { fetchApiBlob } from "@platform/api/client";

export type ApiBlobUrlState = {
  url: string;
  loading: boolean;
  error: Error | null;
};

const EMPTY_STATE: ApiBlobUrlState = {
  url: "",
  loading: false,
  error: null,
};

export function useApiBlobUrl(
  path: string | null | undefined,
): ApiBlobUrlState {
  const requestId = useRef(0);
  const [state, setState] = useState<ApiBlobUrlState>(EMPTY_STATE);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    if (!path) {
      setState(EMPTY_STATE);
      return;
    }

    const controller = new AbortController();
    let objectUrl = "";
    setState({ url: "", loading: true, error: null });
    void fetchApiBlob(path, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted || requestId.current !== currentRequest)
          return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, error: null });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || requestId.current !== currentRequest)
          return;
        setState({
          url: "",
          loading: false,
          error: caught instanceof Error ? caught : new Error("文件读取失败"),
        });
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return state;
}
