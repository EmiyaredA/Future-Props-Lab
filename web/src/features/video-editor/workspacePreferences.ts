import { MAX_TIMELINE_ZOOM, MIN_TIMELINE_ZOOM } from "./timelineScale";

const WORKSPACE_PREFERENCES_VERSION = 1;
const WORKSPACE_PREFERENCES_KEY_PREFIX = "future-props.video-editor.workspace";

export type VideoEditorWorkspacePreferences = {
  version: typeof WORKSPACE_PREFERENCES_VERSION;
  playheadUs: number;
  selectedClipIds: string[];
  zoom: number;
  timelineScrollLeft: number;
  preciseFrame: boolean;
};

export function defaultVideoEditorWorkspacePreferences(): VideoEditorWorkspacePreferences {
  return {
    version: WORKSPACE_PREFERENCES_VERSION,
    playheadUs: 0,
    selectedClipIds: [],
    zoom: 80,
    timelineScrollLeft: 0,
    preciseFrame: true,
  };
}

function storageKey(projectId: string) {
  return `${WORKSPACE_PREFERENCES_KEY_PREFIX}:${projectId}`;
}

function finiteNonNegative(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalize(
  value: unknown,
): VideoEditorWorkspacePreferences | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== WORKSPACE_PREFERENCES_VERSION) return undefined;

  const defaults = defaultVideoEditorWorkspacePreferences();
  const zoom = finiteNonNegative(candidate.zoom, defaults.zoom);
  const selectedClipIds = Array.isArray(candidate.selectedClipIds)
    ? [
        ...new Set(
          candidate.selectedClipIds.filter(
            (clipId): clipId is string =>
              typeof clipId === "string" && clipId.length > 0,
          ),
        ),
      ]
    : defaults.selectedClipIds;

  return {
    version: WORKSPACE_PREFERENCES_VERSION,
    playheadUs: finiteNonNegative(candidate.playheadUs, defaults.playheadUs),
    selectedClipIds,
    zoom: Math.max(MIN_TIMELINE_ZOOM, Math.min(MAX_TIMELINE_ZOOM, zoom)),
    timelineScrollLeft: finiteNonNegative(
      candidate.timelineScrollLeft,
      defaults.timelineScrollLeft,
    ),
    preciseFrame:
      typeof candidate.preciseFrame === "boolean"
        ? candidate.preciseFrame
        : defaults.preciseFrame,
  };
}

export function loadVideoEditorWorkspacePreferences(
  projectId: string,
): VideoEditorWorkspacePreferences {
  const defaults = defaultVideoEditorWorkspacePreferences();
  try {
    const stored = window.localStorage.getItem(storageKey(projectId));
    if (!stored) return defaults;
    return normalize(JSON.parse(stored)) ?? defaults;
  } catch {
    return defaults;
  }
}

export function storeVideoEditorWorkspacePreferences(
  projectId: string,
  preferences: VideoEditorWorkspacePreferences,
) {
  try {
    const normalized = normalize(preferences);
    if (!normalized) return;
    window.localStorage.setItem(
      storageKey(projectId),
      JSON.stringify(normalized),
    );
  } catch {
    // Browser storage can be disabled or full. Editor use must remain unaffected.
  }
}
