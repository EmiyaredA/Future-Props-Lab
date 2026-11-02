import { LoadingState } from "@shared/ui/LoadingState";
import { useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { ExternalLink, Globe } from "lucide-react";
import { useAccountId } from "@platform/auth/AccountAccess";
import { getLinkPreview } from "./api";
import { thoughtKeys } from "./queryKeys";
import { useLinkPreview } from "./useLinkPreview";
import { useLinkPreviewPosition } from "./useLinkPreviewPosition";
import "./link-preview.css";

export function LinkPreviewCard({ editor }: { editor: Editor }) {
  const accountId = useAccountId();
  const { anchor, surface, openAction, controls } = useLinkPreview(editor);
  const query = useQuery({
    queryKey: thoughtKeys.linkPreview(accountId ?? "", anchor?.url ?? ""),
    queryFn: ({ signal }) => getLinkPreview(anchor!.url, signal),
    enabled: !!anchor && !!accountId,
    staleTime: (query) => (query.state.data?.available ? 600_000 : 60_000),
    gcTime: 600_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useLinkPreviewPosition(anchor, surface, controls.current.close);
  if (!anchor) return null;
  const data = query.data;
  const loading = query.isPending && !!accountId;
  return (
    <div
      ref={surface}
      popover="manual"
      role="dialog"
      aria-label="链接预览"
      className="thought-link-preview"
      contentEditable={false}
      onPointerEnter={() => controls.current.keep()}
      onPointerLeave={() => controls.current.leave()}
      onFocus={() => controls.current.keep()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          controls.current.leave();
      }}
    >
      <div className="thought-link-preview-source">
        <Globe size={18} aria-hidden="true" />
        <span>{data?.domain || new URL(anchor.url).hostname}</span>
      </div>
      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="thought-link-preview-loading">
            <LoadingState label="正在读取链接信息…" variant="inline" />
            <i />
            <i />
          </div>
        ) : (
          <>
            {data?.title && <h3>{data.title}</h3>}
            {data?.description && (
              <p className="thought-link-preview-description">
                {data.description}
              </p>
            )}
            {!data?.title && (
              <p className="thought-link-preview-url">{anchor.url}</p>
            )}
            {!data?.available && (
              <p className="thought-link-preview-fallback">
                暂时无法获取页面简介
              </p>
            )}
          </>
        )}
      </div>
      <a
        ref={openAction}
        className="thought-link-preview-open"
        href={anchor.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        打开原文 <ExternalLink size={15} aria-hidden="true" />
      </a>
    </div>
  );
}
