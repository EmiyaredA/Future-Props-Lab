export function advancePlayback(
  time: number,
  playing: boolean,
  loop: boolean,
  duration: number,
  delta: number,
) {
  if (!playing) return { time, playing };
  const next = time + delta;
  if (next < duration) return { time: next, playing };
  return loop
    ? { time: next % duration, playing }
    : { time: duration, playing: false };
}

export function startPlaybackClock(
  signal: AbortSignal,
  update: (delta: number, refreshUI: () => boolean) => void,
) {
  let previous = performance.now();
  let lastUI = 0;
  let handle = 0;
  const frame = (now: number) => {
    const delta = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    update(delta, () => {
      if (now - lastUI <= 50) return false;
      lastUI = now;
      return true;
    });
    if (!signal.aborted) handle = requestAnimationFrame(frame);
  };
  if (signal.aborted) return;
  handle = requestAnimationFrame(frame);
  signal.addEventListener("abort", () => cancelAnimationFrame(handle), {
    once: true,
  });
}
