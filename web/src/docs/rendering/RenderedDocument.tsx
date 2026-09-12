import { useEffect, useMemo, type ComponentPropsWithoutRef } from "react";
import type { GuidePage } from "../types";
import { resolveDocLink } from "../content";
import { compileDocument } from "./compileDocument";
import { DocumentRenderer } from "./DocumentRenderer";
import "./blocks.css";
import "./media.css";

export default function RenderedDocument({
  page,
  onImage,
}: {
  page: GuidePage;
  onImage: (src: string, alt: string) => void;
}) {
  const result = useMemo(() => {
    try {
      return { document: compileDocument(page), error: "" };
    } catch (error) {
      return {
        document: null,
        error: error instanceof Error ? error.message : "文档格式错误",
      };
    }
  }, [page]);
  useEffect(() => {
    if (!location.hash) return;
    let id = location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      return;
    }
    const frame = requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView(),
    );
    return () => cancelAnimationFrame(frame);
  }, [page]);
  if (!result.document)
    return <div role="alert">文档渲染失败：{result.error}</div>;
  return (
    <div className="docs-prose docs-document">
      <DocumentRenderer
        document={result.document}
        urls={{
          pageHref: (target) =>
            `/docs.html?page=${encodeURIComponent(target.id)}`,
          assetHref: (src) => src,
          displayAssetHref: (src) => src,
        }}
        resolveLink={(href) => resolveDocLink(page, href)}
        components={{
          img: ({
            src = "",
            alt = "",
            title,
          }: ComponentPropsWithoutRef<"img">) => (
            <span className="docs-shot">
              <button
                type="button"
                aria-label={`放大图片：${alt}`}
                onClick={(event) => {
                  event.currentTarget.focus();
                  onImage(src, alt);
                }}
              >
                <img src={src} alt={alt} loading="lazy" />
              </button>
              <span className="docs-caption">{title || alt}</span>
            </span>
          ),
        }}
      />
    </div>
  );
}
