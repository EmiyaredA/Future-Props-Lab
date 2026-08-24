import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  DEFAULT_SCRIPT_LAYOUT,
  normalizeScriptLayout,
} from "./scriptLayoutPreferences";
import type { GalgameWorkshopEditorBase } from "./useGalgameWorkshopEditorBase";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function createGalgameEditorLayout(
  base: Pick<
    GalgameWorkshopEditorBase,
    | "editorGridRef"
    | "resizeCleanupRef"
    | "scriptLayout"
    | "scriptView"
    | "setScriptLayout"
    | "setStageViewportPreferences"
    | "stageViewportPreferences"
  >,
) {
  const {
    editorGridRef,
    resizeCleanupRef,
    scriptLayout,
    scriptView,
    setScriptLayout,
    setStageViewportPreferences,
    stageViewportPreferences,
  } = base;
  const startStageResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      stageViewportPreferences.collapsed ||
      event.button !== 0 ||
      window.innerWidth <= 980
    ) {
      return;
    }
    event.preventDefault();
    resizeCleanupRef.current?.();
    const move = (pointer: PointerEvent) => {
      const grid = editorGridRef.current;
      const bounds = grid?.getBoundingClientRect();
      if (!grid || !bounds) return;
      setScriptLayout((current) =>
        normalizeScriptLayout({
          ...current,
          previewSplitRatio:
            Math.round(
              clamp(
                ((pointer.clientY - bounds.top) / bounds.height) * 100,
                42,
                72,
              ) * 100,
            ) / 100,
        }),
      );
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      resizeCleanupRef.current = undefined;
    };
    resizeCleanupRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const setStageCollapsed = (collapsed: boolean) => {
    setStageViewportPreferences((current) => ({ ...current, collapsed }));
  };

  const startSidebarResize = (
    side: "left" | "right",
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    globalThis.document.body.classList.add("galgame-sidebar-resizing");

    const move = (pointer: PointerEvent) => {
      const bounds = editorGridRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const available = Math.max(1, bounds.width - 12);
      const pointerRatio =
        ((pointer.clientX - bounds.left - (side === "right" ? 6 : 0)) /
          available) *
        100;
      setScriptLayout((current) =>
        normalizeScriptLayout(
          side === "left"
            ? { ...current, leftRatio: pointerRatio }
            : scriptView === "performance" || scriptView === "localization"
              ? {
                  ...current,
                  performanceCenterRatio: pointerRatio - current.leftRatio,
                }
              : {
                  ...current,
                  centerRatio: pointerRatio - current.leftRatio,
                },
        ),
      );
    };
    const finish = () => {
      globalThis.document.body.classList.remove("galgame-sidebar-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      resizeCleanupRef.current = undefined;
    };
    resizeCleanupRef.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const resizeSidebarWithKeyboard = (
    side: "left" | "right",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 0.5 : -0.5;
    setScriptLayout((current) =>
      normalizeScriptLayout(
        side === "left"
          ? { ...current, leftRatio: current.leftRatio + delta }
          : scriptView === "performance" || scriptView === "localization"
            ? {
                ...current,
                performanceCenterRatio: current.performanceCenterRatio + delta,
              }
            : { ...current, centerRatio: current.centerRatio + delta },
      ),
    );
  };

  const resetSidebarWidth = (side: "left" | "right") =>
    setScriptLayout((current) =>
      normalizeScriptLayout(
        side === "left"
          ? { ...current, leftRatio: DEFAULT_SCRIPT_LAYOUT.leftRatio }
          : scriptView === "performance" || scriptView === "localization"
            ? {
                ...current,
                performanceCenterRatio:
                  DEFAULT_SCRIPT_LAYOUT.performanceCenterRatio,
              }
            : { ...current, centerRatio: DEFAULT_SCRIPT_LAYOUT.centerRatio },
      ),
    );

  const effectiveCenterRatio =
    scriptView === "performance" || scriptView === "localization"
      ? scriptLayout.performanceCenterRatio
      : scriptLayout.centerRatio;
  const editorGridStyle = {
    "--galgame-script-left-ratio": scriptLayout.leftRatio,
    "--galgame-script-center-ratio": effectiveCenterRatio,
    "--galgame-stage-split": `${scriptLayout.previewSplitRatio}%`,
  } as CSSProperties;

  return {
    startStageResize,
    setStageCollapsed,
    startSidebarResize,
    resizeSidebarWithKeyboard,
    resetSidebarWidth,
    effectiveCenterRatio,
    editorGridStyle,
  };
}
