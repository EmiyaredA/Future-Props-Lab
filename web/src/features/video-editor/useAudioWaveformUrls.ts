import { fetchApiBlob } from "@platform/api/client";
import { useEffect, useMemo, useState } from "react";
import type { VideoEditorAsset } from "./types";

/** One authenticated waveform download per asset, shared by all its timeline clips. */
export function useAudioWaveformUrls(assets: VideoEditorAsset[]) {
  const pathKey = [
    ...new Set(
      assets
        .filter((asset) => asset.mediaKind === "audio")
        .map((asset) => asset.waveformUrl)
        .filter((path): path is string => Boolean(path)),
    ),
  ]
    .sort()
    .join("\n");
  const paths = useMemo(() => (pathKey ? pathKey.split("\n") : []), [pathKey]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    const created: string[] = [];
    setUrls({});
    void Promise.all(
      paths.map(async (path) => {
        try {
          const blob = await fetchApiBlob(path, { signal: controller.signal });
          if (controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          setUrls((current) => ({ ...current, [path]: url }));
        } catch {
          // A missing or still-processing waveform leaves the clip readable.
        }
      }),
    );
    return () => {
      controller.abort();
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [paths]);
  return urls;
}
