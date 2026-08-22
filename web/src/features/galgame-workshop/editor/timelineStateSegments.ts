import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import type { timelineEvents } from "@features/galgame-workshop/editor/timeline";

type TimelineEvent = ReturnType<typeof timelineEvents>[number];

export function timelineStateSegments({
  pointEvents,
  document,
  durationMs,
}: {
  pointEvents: TimelineEvent[];
  document: GalgameStoryProject;
  durationMs: number;
}) {
  return pointEvents.flatMap((event, eventIndex) => {
    const block = event.block;
    const laneId =
      block.type === "scene"
        ? "scene"
        : block.type === "showCg"
          ? "cg"
          : block.type === "showCharacter"
            ? `character:${block.characterId}`
            : block.type === "setStageCast"
              ? "cast"
              : block.type === "audio" &&
                  block.action === "play" &&
                  (block.channel === "bgm" || block.channel === "ambient")
                ? block.channel
                : undefined;
    if (!laneId) return [];
    const next = pointEvents.slice(eventIndex + 1).find((candidate) => {
      if (candidate.timeMs <= event.timeMs) return false;
      if (block.type === "scene") return candidate.block.type === "scene";
      if (block.type === "showCg")
        return (
          candidate.block.type === "showCg" || candidate.block.type === "hideCg"
        );
      if (block.type === "showCharacter")
        return (
          (candidate.block.type === "scene" &&
            candidate.block.clearCharacters !== false) ||
          ((candidate.block.type === "showCharacter" ||
            candidate.block.type === "removeCharacter") &&
            (candidate.block.type !== "removeCharacter" ||
              candidate.block.all ||
              candidate.block.characterId === block.characterId) &&
            (candidate.block.type !== "showCharacter" ||
              candidate.block.characterId === block.characterId))
        );
      if (block.type === "setStageCast")
        return (
          (candidate.block.type === "scene" &&
            candidate.block.clearCharacters !== false) ||
          candidate.block.type === "setStageCast"
        );
      if (block.type !== "audio") return false;
      return (
        candidate.block.type === "audio" &&
        candidate.block.channel === block.channel
      );
    });
    const asset =
      block.type === "audio"
        ? (document.assets ?? []).find((item) => item.id === block.assetId)
        : undefined;
    const label =
      block.type === "scene"
        ? ((document.scenes ?? []).find((scene) => scene.id === block.sceneId)
            ?.name ?? "场景")
        : block.type === "showCharacter"
          ? ((document.characters ?? []).find(
              (character) => character.id === block.characterId,
            )?.name ?? "角色")
          : block.type === "setStageCast"
            ? (block.members ?? []).length
              ? (block.members ?? [])
                  .map(
                    (member) =>
                      (document.characters ?? []).find(
                        (character) => character.id === member.characterId,
                      )?.name ?? "角色",
                  )
                  .join("、")
              : "清空角色"
            : block.type === "showCg"
              ? ((document.cgs ?? []).find((cg) => cg.id === block.cgId)
                  ?.name ?? "剧情 CG")
              : asset?.type === "audio"
                ? asset.label
                : "声音";
    return [
      {
        id: `state:${block.id}`,
        laneId,
        label,
        kind:
          block.type === "scene"
            ? ("scene" as const)
            : block.type === "showCharacter"
              ? ("character" as const)
              : block.type === "setStageCast"
                ? ("character" as const)
                : block.type === "showCg"
                  ? ("cg" as const)
                  : block.type === "audio"
                    ? block.channel
                    : ("scene" as const),
        startMs: event.timeMs,
        endMs: next?.timeMs ?? durationMs,
      },
    ];
  });
}
