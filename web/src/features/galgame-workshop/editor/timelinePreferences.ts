const TIMELINE_PREFERENCES_KEY = "future_props_galgame_timeline_preferences";

export const MIN_TIMELINE_ZOOM = 120;
export const MAX_TIMELINE_ZOOM = 960;

export type TimelinePreferences = {
  zoom: number;
  ripple: boolean;
  loop: boolean;
};

export function loadTimelinePreferences(): TimelinePreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(TIMELINE_PREFERENCES_KEY) ?? "null",
    ) as { zoom?: number; ripple?: boolean; loop?: boolean } | null;
    return {
      zoom: Math.min(
        MAX_TIMELINE_ZOOM,
        Math.max(MIN_TIMELINE_ZOOM, value?.zoom ?? 300),
      ),
      ripple: value?.ripple ?? false,
      loop: value?.loop ?? false,
    };
  } catch {
    return { zoom: 300, ripple: false, loop: false };
  }
}

export function storeTimelinePreferences(value: TimelinePreferences) {
  localStorage.setItem(TIMELINE_PREFERENCES_KEY, JSON.stringify(value));
}
