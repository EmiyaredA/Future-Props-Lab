export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function initialAmadeusBounds(
  saved: WindowBounds | undefined,
  workArea: WindowBounds,
): WindowBounds {
  const width = Math.min(workArea.width, Math.max(400, saved?.width ?? 900));
  const height = Math.min(workArea.height, Math.max(500, saved?.height ?? 760));
  const rightEdge = saved
    ? saved.x + saved.width
    : workArea.x + workArea.width - 28;
  return {
    width,
    height,
    x: Math.max(
      workArea.x,
      Math.min(rightEdge - width, workArea.x + workArea.width - width),
    ),
    y: Math.max(
      workArea.y,
      Math.min(
        saved?.y ?? workArea.y + 48,
        workArea.y + workArea.height - height,
      ),
    ),
  };
}

export function collapsedAmadeusBounds(
  current: WindowBounds,
  stageOpen: boolean,
  collapsedWidth: number,
): WindowBounds {
  if (!stageOpen) return current;
  return {
    ...current,
    x: current.x + current.width - collapsedWidth,
    width: collapsedWidth,
  };
}
