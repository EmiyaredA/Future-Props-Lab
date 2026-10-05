export function syncMediaClock(
  node: HTMLMediaElement,
  targetSeconds: number,
  {
    playing,
    playStarted,
    toleranceSeconds,
  }: {
    playing: boolean;
    playStarted: boolean;
    toleranceSeconds: number;
  },
) {
  if (node.seeking) return;
  const drift = Math.abs(node.currentTime - targetSeconds);
  if (!playing || playStarted || drift > toleranceSeconds) {
    node.currentTime = Math.max(0, targetSeconds);
  }
}
