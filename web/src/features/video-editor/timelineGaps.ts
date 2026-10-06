import type { VideoEditorTimeline } from "./types";

export type TimelineGap = {
  id: string;
  trackId: string;
  trackName: string;
  fromClipId: string;
  toClipId: string;
  fromName: string;
  toName: string;
  startUs: number;
  endUs: number;
  durationUs: number;
};

/** Track-local picture coverage. Text does not cover a missing picture. */
export function findTimelineGaps(timeline: VideoEditorTimeline): TimelineGap[] {
  return [...(timeline.document.tracks ?? [])]
    .filter((track) => track.kind !== "audio" && !track.hidden)
    .sort((a, b) => a.order - b.order)
    .flatMap((track) => {
      const pictures = (track.clips ?? [])
        .filter((clip) => ["video", "image", "color"].includes(clip.kind))
        .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
      const gaps: TimelineGap[] = [];
      let left = pictures[0];
      for (const right of pictures.slice(1)) {
        const startUs = left.timelineStartUs + left.durationUs;
        const endUs = right.timelineStartUs;
        if (endUs > startUs) {
          gaps.push({
            id: JSON.stringify([track.id, left.id, right.id, startUs, endUs]),
            trackId: track.id,
            trackName: track.name,
            fromClipId: left.id,
            toClipId: right.id,
            fromName: left.name,
            toName: right.name,
            startUs,
            endUs,
            durationUs: endUs - startUs,
          });
        }
        if (right.timelineStartUs + right.durationUs > startUs) left = right;
      }
      return gaps;
    });
}

export function preciseGapTime(timeUs: number) {
  const minutes = Math.floor(timeUs / 60_000_000);
  const seconds = Math.floor(timeUs / 1_000_000) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(timeUs % 1_000_000).padStart(6, "0")}`;
}
