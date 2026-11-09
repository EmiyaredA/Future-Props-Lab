// Adapted from Happier 2aeb139d, transcript/scroll/resolveTranscriptBottomFollowIntent.ts.
// MIT notice in /brand/amadeus/HAPPIER-LICENSE.txt.
export function bottomFollowIntent(
  following: boolean,
  previous: number,
  offset: number,
  distance: number,
  canRelease: boolean,
) {
  if (distance <= 1) return true;
  if (canRelease && offset < previous) return false;
  if (offset > previous && distance <= 32) return true;
  return following;
}
