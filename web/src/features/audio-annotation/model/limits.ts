export const MIN_SEGMENT_MS = 100;
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const WAVEFORM_ZOOM_RATIOS = [1, 2, 4, 8, 16, 32, 64, 128, 256] as const;
export const MAX_WAVEFORM_ZOOM = WAVEFORM_ZOOM_RATIOS.at(-1)!;
