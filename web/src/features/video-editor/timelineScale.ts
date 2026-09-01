export const MIN_TIMELINE_ZOOM = 10;
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
