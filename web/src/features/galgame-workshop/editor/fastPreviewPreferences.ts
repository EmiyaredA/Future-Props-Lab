const AUTHORING_OVERLAYS_KEY =
  "future-props.galgame.fast-preview.authoring-overlays";
const AUTO_REVEAL_PORTRAITS_KEY =
  "future-props.galgame.fast-preview.auto-reveal-portraits";

export function loadFastPreviewAuthoringOverlays() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTHORING_OVERLAYS_KEY) === "true";
}

export function saveFastPreviewAuthoringOverlays(visible: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTHORING_OVERLAYS_KEY, String(visible));
}

export function loadFastPreviewAutoRevealPortraits() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTO_REVEAL_PORTRAITS_KEY) === "true";
}

export function saveFastPreviewAutoRevealPortraits(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTO_REVEAL_PORTRAITS_KEY, String(enabled));
}
