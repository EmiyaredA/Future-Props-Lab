/** Media capabilities used by editing commands; adapters own decoding and playback. */
export type AnnotationPlayback = {
  playPause: () => void;
  playRange: (startMs: number, endMs: number) => void;
  pause: () => void;
  seekMs: (milliseconds: number) => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  zoom: (ratio: number, anchorMs?: number) => void;
  scrollTo: (startMs: number) => void;
  panBy: (viewportFraction: number) => void;
  setFocusSelectionMode: (enabled: boolean) => void;
  exportRangeWav: (startMs: number, endMs: number) => Blob | null;
};
