import { useEffect, useRef, useState } from "react";
import type { SlideElement } from "../types";
import ChartSvg from "./ChartSvg";

export default function ChartPreview({ element }: { element: SlideElement }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(1, Math.round(entry.contentRect.width)));
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={host} className="presentation-chart-preview-host">
      <ChartSvg element={{ ...element, width, height: 200 }} />
    </div>
  );
}
