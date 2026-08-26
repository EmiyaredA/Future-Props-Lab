const AUTHORING_OVERLAYS_KEY =
  "future-props.galgame.fast-preview.authoring-overlays";

export function loadFastPreviewAuthoringOverlays() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTHORING_OVERLAYS_KEY) === "true";
}

export function saveFastPreviewAuthoringOverlays(visible: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTHORING_OVERLAYS_KEY, String(visible));
}
