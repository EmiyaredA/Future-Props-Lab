import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  DEFAULT_EDITOR_LAYOUT,
  resolveEditorLayout,
  type VideoEditorLayout,
} from "./editorLayout";
import type { VideoEditorSeparatorProps } from "./VideoEditorSeparator";

export function useVideoEditorLayout(
  layout: VideoEditorLayout,
  setLayout: Dispatch<SetStateAction<VideoEditorLayout>>,
) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ width: 1160, height: 900 });
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.height)
        setBounds({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  const sizes = resolveEditorLayout(layout, bounds.width, bounds.height);
  const separator = (
    key: keyof VideoEditorLayout,
  ): VideoEditorSeparatorProps => {
    const timeline = key === "timelineRatio";
    const factor = timeline ? sizes.availableHeight : 1;
    const values = {
      assetWidth: {
        label: "调整素材栏宽度",
        value: sizes.assetWidth,
        min: 200,
        max: sizes.assetMax,
      },
      inspectorWidth: {
        label: "调整属性栏宽度",
        value: sizes.inspectorWidth,
        min: 280,
        max: sizes.inspectorMax,
      },
      trackHeaderWidth: {
        label: "调整轨道名称栏宽度",
        value: sizes.trackHeaderWidth,
        min: 176,
        max: 320,
      },
      timelineRatio: {
        label: "调整时间轴高度",
        value: sizes.timelineHeight,
        min: 180,
        max: sizes.availableHeight - 220,
      },
    };
    return {
      ...values[key],
      orientation: timeline ? "horizontal" : "vertical",
      reverse: timeline || key === "inspectorWidth",
      restoreValue: layout[key] * factor,
      onChange: (value) =>
        setLayout((current) => ({ ...current, [key]: value / factor })),
      onReset: () =>
        setLayout((current) => ({
          ...current,
          [key]: DEFAULT_EDITOR_LAYOUT[key],
        })),
    };
  };
  return {
    ref: setNode,
    separator,
    style: {
      "--ve-asset-width": `${sizes.assetWidth}px`,
      "--ve-inspector-width": `${sizes.inspectorWidth}px`,
      "--ve-upper-height": `${sizes.availableHeight - sizes.timelineHeight}px`,
      "--ve-timeline-height": `${sizes.timelineHeight}px`,
    } as CSSProperties,
    reset: () => setLayout({ ...DEFAULT_EDITOR_LAYOUT }),
  };
}
