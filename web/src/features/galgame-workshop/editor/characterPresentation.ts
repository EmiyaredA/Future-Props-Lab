import type {
  GalgameStoryCharacterStageSettings,
  GalgameStoryCharacterTransform,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  characterStageSettings,
  type ResolvedCharacterStageSettings,
} from "@features/galgame-workshop/editor/characterStageSettings";

export type CharacterDistance = "far" | "medium" | "near";

export type CharacterPresentation = {
  distance: CharacterDistance;
  positionId: string;
};

export type CharacterPresentationStage = {
  actors: Record<
    string,
    {
      characterId: string;
      distance?: CharacterDistance;
      positionId?: string;
      transform: { x: number };
    }
  >;
};

const POSITION_IDS = {
  outerLeft: "position-outer-left",
  left: "position-left",
  centerLeft: "position-center-left",
  center: "position-center",
  centerRight: "position-center-right",
  right: "position-right",
  outerRight: "position-outer-right",
} as const;

const SLOT_PLANS = [
  [POSITION_IDS.center],
  [POSITION_IDS.left, POSITION_IDS.right],
  [POSITION_IDS.left, POSITION_IDS.center, POSITION_IDS.right],
  [
    POSITION_IDS.outerLeft,
    POSITION_IDS.centerLeft,
    POSITION_IDS.centerRight,
    POSITION_IDS.outerRight,
  ],
  [
    POSITION_IDS.outerLeft,
    POSITION_IDS.left,
    POSITION_IDS.center,
    POSITION_IDS.right,
    POSITION_IDS.outerRight,
  ],
  [
    POSITION_IDS.outerLeft,
    POSITION_IDS.left,
    POSITION_IDS.centerLeft,
    POSITION_IDS.centerRight,
    POSITION_IDS.right,
    POSITION_IDS.outerRight,
  ],
] as const;

function presetById(
  settings: ResolvedCharacterStageSettings,
  positionId: string,
) {
  return settings.positionPresets.find((preset) => preset.id === positionId);
}

function effectivePositionId(
  settings: ResolvedCharacterStageSettings,
  positionId?: string,
  x?: number,
) {
  if (positionId && presetById(settings, positionId)) return positionId;
  if (x != null) return nearestCharacterPositionId(settings, x);
  return (
    presetById(settings, settings.defaultPositionId)?.id ??
    settings.positionPresets[0]?.id ??
    POSITION_IDS.center
  );
}

export function nearestCharacterPositionId(
  settings: Pick<GalgameStoryCharacterStageSettings, "positionPresets">,
  x: number,
) {
  const presets = settings.positionPresets ?? [];
  return (
    [...presets].sort(
      (left, right) => Math.abs(left.x - x) - Math.abs(right.x - x),
    )[0]?.id ?? POSITION_IDS.center
  );
}

export function legacyCharacterPresentation(
  settings: ResolvedCharacterStageSettings,
  transform?: GalgameStoryCharacterTransform | null,
): CharacterPresentation {
  const scale = transform?.scale ?? 1;
  return {
    positionId: nearestCharacterPositionId(settings, transform?.x ?? 50),
    distance:
      scale < 0.72 ? "far" : scale > 1.2 && scale <= 1.6 ? "near" : "medium",
  };
}

export function suggestCharacterPresentation(
  document: GalgameStoryProject,
  characterId: string,
  stage?: CharacterPresentationStage,
): CharacterPresentation {
  const settings = characterStageSettings(document, characterId);
  const existing = stage?.actors[characterId];
  if (existing)
    return {
      positionId: effectivePositionId(
        settings,
        existing.positionId,
        existing.transform.x,
      ),
      distance: existing.distance ?? "medium",
    };

  const actors = Object.values(stage?.actors ?? {});
  if (!actors.length)
    return {
      positionId: effectivePositionId(settings, settings.defaultPositionId),
      distance: "medium",
    };

  const occupiedX = actors.map((actor) => actor.transform.x);
  const requestedPlan =
    SLOT_PLANS[Math.min(actors.length, SLOT_PLANS.length - 1)];
  const candidates = requestedPlan
    .map((positionId) => presetById(settings, positionId))
    .filter((preset) => preset != null);
  const pool = candidates.length ? candidates : settings.positionPresets;
  const selected = [...pool].sort((left, right) => {
    const leftGap = Math.min(...occupiedX.map((x) => Math.abs(left.x - x)));
    const rightGap = Math.min(...occupiedX.map((x) => Math.abs(right.x - x)));
    return rightGap - leftGap || left.x - right.x;
  })[0];

  return {
    positionId: selected?.id ?? effectivePositionId(settings),
    distance: actors.length >= 5 ? "far" : "medium",
  };
}
