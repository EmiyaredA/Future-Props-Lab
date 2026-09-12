import { lazy, memo, Suspense, useRef } from "react";
import type { GuidePage } from "./types";
const RenderedDocument = lazy(() => import("./rendering/RenderedDocument"));

export function CopyButton({
  value,
  label = "复制代码",
}: {
  value: string;
  label?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          if (ref.current) ref.current.textContent = "已复制";
        } catch {
          if (ref.current) ref.current.textContent = "复制失败，请选择文字复制";
        }
      }}
      ref={ref}
    >
      {label}
    </button>
  );
}

export const DocsMarkdown = memo(function DocsMarkdown({
  page,
  onImage,
}: {
  page: GuidePage;
  onImage: (src: string, alt: string) => void;
}) {
  return (
    <Suspense fallback={<p role="status">正在加载文档…</p>}>
      <RenderedDocument page={page} onImage={onImage} />
    </Suspense>
  );
});
