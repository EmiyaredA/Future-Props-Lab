import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { useLayoutEffect, useRef, useState } from "react";

/** Keep the decoded frame on screen until its requested replacement is ready. */
export function VideoEditorPreciseFrame({ url }: { url: string }) {
  const [displayedUrl, setDisplayedUrl] = useState("");
  const [failedUrl, setFailedUrl] = useState("");
  const requestedUrl = useRef(url);
  useLayoutEffect(() => {
    requestedUrl.current = url;
  }, [url]);
  const urls =
    displayedUrl && displayedUrl !== url ? [displayedUrl, url] : [url];
  const pending = displayedUrl !== url;
  return (
    <>
      {urls.map((frameUrl) => (
        <ResponsiveImage
          className="ve-precise-frame"
          key={frameUrl}
          src={frameUrl}
          alt={frameUrl === url ? "后端精确停帧" : "上一张已加载的节目帧"}
          style={{
            visibility: frameUrl === displayedUrl ? "visible" : "hidden",
          }}
          onLoad={(event) => {
            if (
              requestedUrl.current !== frameUrl ||
              !event.currentTarget.isConnected
            )
              return;
            setDisplayedUrl(frameUrl);
            setFailedUrl("");
          }}
          onError={() => {
            if (requestedUrl.current === frameUrl) setFailedUrl(frameUrl);
          }}
        />
      ))}
      {pending && (displayedUrl || failedUrl === url) ? (
        <span className="ve-preview-frame-status" role="status">
          {failedUrl === url ? "精确画面加载失败" : "画面更新中…"}
        </span>
      ) : null}
    </>
  );
}
