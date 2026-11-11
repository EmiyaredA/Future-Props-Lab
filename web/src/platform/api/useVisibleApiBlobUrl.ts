import { useEffect, useRef, useState } from "react";
import { useApiBlobUrl } from "./useApiBlobUrl";

/** Defer the authenticated fetch until the preview is near the viewport. */
export function useVisibleApiBlobUrl(
  path: string | null,
  {
    active = false,
    fallbackMimeType,
  }: { active?: boolean; fallbackMimeType?: string } = {},
) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    if (!globalThis.IntersectionObserver) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return {
    ref,
    visible,
    ...useApiBlobUrl(visible || active ? path : null, fallbackMimeType),
  };
}
