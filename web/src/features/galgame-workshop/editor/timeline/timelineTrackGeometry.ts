import {
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
} from "@features/galgame-workshop/editor/timelinePreferences";

export type StoryTimelineLane = { id: string; label: string };

export function fittedTimelineZoom(
  container: HTMLElement,
  durationMs: number,
  fallbackLabelWidth: number,
) {
  const configuredLabelWidth = Number.parseFloat(
    globalThis
      .getComputedStyle(container)
      .getPropertyValue("--galgame-timeline-label-width"),
  );
  const labelWidth = Number.isFinite(configuredLabelWidth)
    ? configuredLabelWidth
    : fallbackLabelWidth;
  const availableWidth = Math.max(320, container.clientWidth - labelWidth);
  return Math.min(
    MAX_TIMELINE_ZOOM,
    Math.max(
      MIN_TIMELINE_ZOOM,
      Math.floor((availableWidth * 60_000) / durationMs),
    ),
  );
}

export function timelineTrackGeometry({
  durationMs,
  zoom,
  characterTracksExpanded,
  visibleCharacterTrackIds,
  characters,
}: {
  durationMs: number;
  zoom: number;
  characterTracksExpanded: boolean;
  visibleCharacterTrackIds: string[];
  characters: ReadonlyMap<string, { name: string }>;
}) {
  const laneHeight = 40;
  const lanes: StoryTimelineLane[] = [
    { id: "scene", label: "场景" },
    { id: "cg", label: "CG" },
    ...(characterTracksExpanded
      ? visibleCharacterTrackIds.map((characterId) => ({
          id: `character:${characterId}`,
          label: characters.get(characterId)?.name ?? "未知角色",
        }))
      : []),
    { id: "dialogue", label: "对白 / 角色 / 配音" },
    { id: "bgm", label: "BGM" },
    { id: "ambient", label: "环境音" },
    { id: "sfx", label: "音效" },
    { id: "structure", label: "分支 / 结局" },
  ];
  const laneTop = (laneId: string) =>
    Math.max(
      0,
      lanes.findIndex((lane) => lane.id === laneId),
    ) * laneHeight;
  const tickEveryMs = zoom >= 600 ? 5000 : zoom >= 240 ? 10_000 : 30_000;
  return {
    trackWidth: Math.max(640, (durationMs / 60_000) * zoom),
    laneHeight,
    lanes,
    laneTop,
    dialogueTop: laneTop("dialogue"),
    trackHeight: lanes.length * laneHeight,
    tickEveryMs,
    ticks: Array.from(
      { length: Math.floor(durationMs / tickEveryMs) + 1 },
      (_, index) => index * tickEveryMs,
    ),
  };
}
