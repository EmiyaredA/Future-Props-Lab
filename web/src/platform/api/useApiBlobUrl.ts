import { useEffect, useRef, useState } from "react";
import type { TransferProgress } from "./transfer";
import { fetchApiBlob } from "@platform/api/client";

export type ApiBlobUrlState = {
  url: string;
  loading: boolean;
  error: Error | null;
  mimeType?: string;
  progress?: TransferProgress;
};

const EMPTY_STATE: ApiBlobUrlState = {
  url: "",
  loading: false,
  error: null,
  mimeType: "",
};

export function useApiBlobUrl(
  path: string | null | undefined,
  fallbackMimeType?: string,
): ApiBlobUrlState {
  const requestId = useRef(0);
  const [record, setRecord] = useState<{
    path: string | null | undefined;
    fallbackMimeType?: string;
    value: ApiBlobUrlState;
  }>({ path: null, value: EMPTY_STATE });

  useEffect(() => {
    const currentRequest = ++requestId.current;
    const setState = (value: ApiBlobUrlState) =>
      setRecord({ path, fallbackMimeType, value });
    if (!path) {
      setState(EMPTY_STATE);
      return;
    }

    const controller = new AbortController();
    let objectUrl = "";
    setState({ url: "", loading: true, error: null, mimeType: "" });
    void fetchApiBlob(path, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (!controller.signal.aborted && requestId.current === currentRequest)
          setRecord((current) => ({
            path,
            fallbackMimeType,
            value: { ...current.value, progress },
          }));
      },
    })
      .then((blob) => {
        if (controller.signal.aborted || requestId.current !== currentRequest)
          return;
        const media =
          fallbackMimeType &&
          (!blob.type || blob.type === "application/octet-stream")
            ? blob.slice(0, blob.size, fallbackMimeType)
            : blob;
        objectUrl = URL.createObjectURL(media);
        setState({
          url: objectUrl,
          loading: false,
          error: null,
          mimeType: media.type,
        });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || requestId.current !== currentRequest)
          return;
        setState({
          url: "",
          loading: false,
          error: caught instanceof Error ? caught : new Error("文件读取失败"),
          mimeType: "",
        });
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, fallbackMimeType]);

  return record.path === path && record.fallbackMimeType === fallbackMimeType
    ? record.value
    : { ...EMPTY_STATE, loading: Boolean(path) };
}
