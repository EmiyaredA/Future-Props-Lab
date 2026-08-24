import type {
  GalgameStoryProject,
  GalgameStoryFragment,
} from "@features/galgame-workshop/api";
import {
  timelineCgRanges,
  timelineCharacterTiming,
  timelineCues,
  timelineEvents,
  timelineGaps,
  timelineStageMarkers,
  type GalgameTimelineCharacterBlock,
} from "@features/galgame-workshop/editor/timeline";
import { timelineStateSegments } from "@features/galgame-workshop/editor/timelineStateSegments";

export function storyTimelineEditorModel(
  document: GalgameStoryProject,
  fragment: GalgameStoryFragment,
) {
  const cues = timelineCues(fragment);
  const gaps = timelineGaps(fragment);
  const markers = timelineStageMarkers(fragment);
  const events = timelineEvents(fragment);
  const cgRanges = timelineCgRanges(fragment);
  const pointEvents = events.filter(
    (event) =>
      event.block.type === "scene" ||
      event.block.type === "showCg" ||
      event.block.type === "hideCg" ||
      event.block.type === "showCharacter" ||
      event.block.type === "removeCharacter" ||
      event.block.type === "audio",
  );
  const bgmAssets = Array.from(
    new Map(
      events.flatMap((event) => {
        const block = event.block;
        if (
          block.type !== "audio" ||
          block.action !== "play" ||
          block.channel !== "bgm" ||
          !block.assetId
        )
          return [];
        const asset = (document.assets ?? []).find(
          (candidate) =>
            candidate.type === "audio" && candidate.id === block.assetId,
        );
        return asset?.type === "audio" ? [[asset.id, asset] as const] : [];
      }),
    ).values(),
  );
  const characters = new Map(
    (document.characters ?? []).map((character) => [character.id, character]),
  );
  const cgs = new Map((document.cgs ?? []).map((cg) => [cg.id, cg]));
  const characterTrackIds = Array.from(
    new Set(
      pointEvents.flatMap((event) =>
        (event.block.type === "showCharacter" ||
          event.block.type === "removeCharacter") &&
        event.block.characterId
          ? [event.block.characterId]
          : [],
      ),
    ),
  );
  const attachedCharacterEvents = new Map<
    string,
    GalgameTimelineCharacterBlock[]
  >();
  for (const block of fragment.blocks ?? []) {
    if (block.type !== "showCharacter" && block.type !== "removeCharacter")
      continue;
    const timing = timelineCharacterTiming(fragment, block.id);
    if (timing?.mode !== "dialogue") continue;
    attachedCharacterEvents.set(timing.dialogueBlockId, [
      ...(attachedCharacterEvents.get(timing.dialogueBlockId) ?? []),
      block,
    ]);
  }
  const durationMs = fragment.timeline?.durationMs ?? 0;
  const stateSegments = timelineStateSegments({
    pointEvents,
    document,
    durationMs,
  });
  return {
    attachedCharacterEvents,
    bgmAssets,
    cgs,
    cgRanges,
    characterTrackIds,
    characters,
    cues,
    durationMs,
    events,
    gaps,
    markers,
    pointEvents,
    stateSegments,
  };
}
