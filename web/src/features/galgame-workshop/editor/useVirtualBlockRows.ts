import { useEffect, useLayoutEffect, useRef, useState } from "react";

const DEFAULT_ROW_HEIGHT = 116;

export function useVirtualBlockRows({
  count,
  selectedIndex,
  overscan = 12,
}: {
  count: number;
  selectedIndex: number;
  overscan?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef(new Map<number, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(900);
  const [, setMeasurementRevision] = useState(0);

  const starts = new Array<number>(count);
  let totalHeight = 0;
  for (let index = 0; index < count; index += 1) {
    starts[index] = totalHeight;
    totalHeight += heightsRef.current.get(index) ?? DEFAULT_ROW_HEIGHT;
  }
  const metrics = { starts, totalHeight };

  let firstVisibleIndex = 0;
  for (let index = 0; index < metrics.starts.length; index += 1) {
    if (metrics.starts[index] > scrollTop) break;
    firstVisibleIndex = index;
  }
  const startIndex = Math.max(0, firstVisibleIndex - overscan);
  let endIndex = Math.min(count, startIndex + overscan * 2 + 1);
  while (
    endIndex < count &&
    metrics.starts[endIndex] < scrollTop + viewportHeight
  )
    endIndex += 1;
  endIndex = Math.min(count, endIndex + overscan);
  const indexes = Array.from(
    { length: Math.max(0, endIndex - startIndex) },
    (_, offset) => startIndex + offset,
  );
  const visibleKey = indexes.join(":");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || selectedIndex < 0 || selectedIndex >= count) return;
    let top = 0;
    for (let index = 0; index < selectedIndex; index += 1)
      top += heightsRef.current.get(index) ?? DEFAULT_ROW_HEIGHT;
    const bottom =
      top + (heightsRef.current.get(selectedIndex) ?? DEFAULT_ROW_HEIGHT);
    if (top < container.scrollTop)
      container.scrollTo({ top: Math.max(0, top - 12) });
    else if (bottom > container.scrollTop + container.clientHeight)
      container.scrollTo({ top: bottom - container.clientHeight + 12 });
  }, [count, selectedIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateViewport = () =>
      setViewportHeight(container.clientHeight || 900);
    updateViewport();
    const resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateViewport);
    resize?.observe(container);
    return () => resize?.disconnect();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const index = Number(
          (entry.target as HTMLElement).dataset.virtualIndex,
        );
        const height = Math.ceil(
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height,
        );
        if (
          Number.isFinite(index) &&
          heightsRef.current.get(index) !== height
        ) {
          heightsRef.current.set(index, height);
          changed = true;
        }
      }
      if (changed) setMeasurementRevision((value) => value + 1);
    });
    for (const row of container.querySelectorAll<HTMLElement>(
      "[data-virtual-index]",
    ))
      resize.observe(row);
    return () => resize.disconnect();
  }, [visibleKey]);

  return {
    containerRef,
    indexes,
    starts: metrics.starts,
    totalHeight: metrics.totalHeight,
    onScroll: () => setScrollTop(containerRef.current?.scrollTop ?? 0),
  };
}
