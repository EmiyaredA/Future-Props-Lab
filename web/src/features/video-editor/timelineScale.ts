export const MIN_TIMELINE_ZOOM = 1;
export const COMFORT_MIN_TIMELINE_ZOOM = 10;
export const MAX_TIMELINE_ZOOM = 240;

const RULER_STEPS_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300];
const MIN_RULER_TICK_WIDTH_PX = 48;

export function getTimelineRulerStepSeconds(zoom: number) {
  return (
    RULER_STEPS_SECONDS.find(
      (stepSeconds) => stepSeconds * zoom >= MIN_RULER_TICK_WIDTH_PX,
    ) ?? RULER_STEPS_SECONDS.at(-1)!
  );
}

/** px/s that packs the effective sequence into the current content viewport. */
export function fittedTimelineZoom(
  availableWidthPx: number,
  durationSeconds: number,
) {
  const width = Math.max(1, availableWidthPx);
  const seconds = Math.max(1, durationSeconds);
  return Math.max(
    MIN_TIMELINE_ZOOM,
    Math.min(MAX_TIMELINE_ZOOM, Math.floor(width / seconds)),
  );
}

/**
 * Slider / wheel lower bound: short edits keep a comfort floor so empty
 * workspace remains; long sequences drop to the fit scale so the whole
 * effective clip extent can enter one viewport (Premiere / FCP / Resolve).
 */
export function timelineZoomMinimum(
  availableWidthPx: number,
  durationSeconds: number,
) {
  if (!(availableWidthPx > 0) || !(durationSeconds > 0)) {
    return COMFORT_MIN_TIMELINE_ZOOM;
  }
  return Math.min(
    COMFORT_MIN_TIMELINE_ZOOM,
    fittedTimelineZoom(availableWidthPx, durationSeconds),
  );
}

export function clampTimelineZoom(
  zoom: number,
  minZoom = COMFORT_MIN_TIMELINE_ZOOM,
) {
  const floor = Math.max(
    MIN_TIMELINE_ZOOM,
    Math.min(MAX_TIMELINE_ZOOM, minZoom),
  );
  if (!Number.isFinite(zoom)) return floor;
  return Math.max(floor, Math.min(MAX_TIMELINE_ZOOM, Math.round(zoom)));
}
