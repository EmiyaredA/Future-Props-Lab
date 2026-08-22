import type {
  GalgameStoryBlock,
  GalgameStoryCharacterTransform,
  GalgameStoryCharacterTransition,
  GalgameStoryCgOverlay,
  GalgameStoryCgTransition,
  GalgameStoryDialoguePortrait,
  GalgameStoryDialogueBoxStyle,
  GalgameStoryFragment,
  GalgameStoryProject,
  GalgameStoryStageCastMember,
} from "@features/galgame-workshop/api";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import { characterStageSettings } from "@features/galgame-workshop/editor/characterStageSettings";
import {
  activeTimelineCue,
  timelineEvents,
} from "@features/galgame-workshop/editor/timeline";

export const DEFAULT_CHARACTER_TRANSFORM: Required<GalgameStoryCharacterTransform> =
  {
    x: 50,
    y: 100,
    anchor: "bottomCenter",
    scale: 1,
    brightness: 1,
    opacity: 1,
    flipX: false,
    layer: 10,
  };

export const CHARACTER_POSITION_MIN = -1000;
export const CHARACTER_POSITION_MAX = 1000;

export const DEFAULT_CHARACTER_TRANSITION: Required<GalgameStoryCharacterTransition> =
  {
    durationMs: 240,
    fade: true,
  };

export type CharacterDistance = "far" | "medium" | "near";

export const CHARACTER_DISTANCE_SCALE: Record<CharacterDistance, number> = {
  far: 0.78,
  medium: 1,
  near: 1.28,
};

export const DEFAULT_CG_TRANSITION: Required<GalgameStoryCgTransition> = {
  durationMs: 400,
  fade: true,
};

export const DEFAULT_CG_OVERLAY: Required<GalgameStoryCgOverlay> = {
  x: 50,
  y: 50,
  width: 60,
  opacity: 1,
  placement: "frontOfCharacters",
};

export type StageActor = {
  characterId: string;
  expressionId?: string;
  skinId?: string;
  distance: CharacterDistance;
  positionId?: string;
  transform: Required<GalgameStoryCharacterTransform>;
  transition: Required<GalgameStoryCharacterTransition>;
  entering: boolean;
  exiting: boolean;
};

export type StageCg = {
  sourceBlockId: string;
  cgId: string;
  variantId: string;
  displayMode: "fullscreen" | "overlay";
  fit: "cover" | "contain";
  overlay: Required<GalgameStoryCgOverlay>;
  transition: Required<GalgameStoryCgTransition>;
  entering: boolean;
  exiting: boolean;
};

export type GalgameStageState = {
  sceneId?: string;
  cg?: StageCg;
  exitingCg?: StageCg;
  actors: Record<string, StageActor>;
  soloActor?: StageActor;
  hiddenCharacterId?: string;
  activeSpeakerId?: string;
  activeSpeakerIds?: string[];
  camera?: {
    target: "stage" | "background" | "characters" | "cg";
    x: number;
    y: number;
    scale: number;
    rotation: number;
    intensity: number;
    effect: string;
    durationMs: number;
    easing: string;
  };
  particle?: { preset: string; density: number };
  floatingText?: {
    text: string;
    x: number;
    y: number;
    color: string;
    durationMs: number;
  };
  curtain?: {
    mode: "fullscreen" | "letterbox" | "pillarbox" | "frame";
    color: string;
    opacity: number;
    durationMs: number;
    visible: boolean;
    action: "show" | "hide";
    transitionKey: string;
  };
  video?: {
    assetId: string;
    loop: boolean;
    volume: number;
    fit: "cover" | "contain";
  };
  stageAnimation?: {
    target: string;
    animation: string;
    durationMs: number;
  };
  spriteAnimations?: Record<
    string,
    {
      sourceBlockId: string;
      animation: string;
      direction: "none" | "left" | "right" | "towardCenter" | "awayFromCenter";
      intensity: number;
      easing: string;
      durationMs: number;
      loop: boolean;
    }
  >;
  autoPlay?: { enabled: boolean; delayMs: number };
  dialoguePreset?: GalgameStoryDialogueBoxStyle["preset"];
};

export function characterTransform(
  value?: GalgameStoryCharacterTransform | null,
): Required<GalgameStoryCharacterTransform> {
  return { ...DEFAULT_CHARACTER_TRANSFORM, ...value };
}

export function characterAssetTransform(
  document: GalgameStoryProject,
  characterId: string,
  value?: GalgameStoryCharacterTransform | null,
  positionId?: string | null,
): Required<GalgameStoryCharacterTransform> {
  const stageSettings = characterStageSettings(document, characterId);
  const defaultPosition =
    stageSettings.positionPresets.find(
      (preset) => preset.id === (positionId ?? stageSettings.defaultPositionId),
    ) ??
    stageSettings.positionPresets.find(
      (preset) => preset.id === stageSettings.defaultPositionId,
    ) ??
    stageSettings.positionPresets[0];
  return {
    ...characterTransform(value),
    x: defaultPosition?.x ?? 50,
    y: defaultPosition?.y ?? 50,
    anchor: stageSettings.anchor,
    scale: value?.scale ?? stageSettings.legacyDefaultScale ?? 1,
  };
}

export function characterTransition(
  value?: GalgameStoryCharacterTransition | null,
): Required<GalgameStoryCharacterTransition> {
  return { ...DEFAULT_CHARACTER_TRANSITION, ...value };
}

export function cgTransition(
  value?: GalgameStoryCgTransition | null,
): Required<GalgameStoryCgTransition> {
  return { ...DEFAULT_CG_TRANSITION, ...value };
}

export function cgOverlay(
  value?: GalgameStoryCgOverlay | null,
): Required<GalgameStoryCgOverlay> {
  return { ...DEFAULT_CG_OVERLAY, ...value };
}

export function emptyStageState(): GalgameStageState {
  return { actors: {} };
}

function resolvedExpression(
  document: GalgameStoryProject,
  characterId: string,
  expressionId?: string | null,
) {
  const character = (document.characters ?? []).find(
    (candidate) => candidate.id === characterId,
  );
  return expressionId ?? character?.defaultExpressionId ?? undefined;
}

function actorFromPortrait(
  document: GalgameStoryProject,
  characterId: string,
  expressionId: string | null | undefined,
  portrait: GalgameStoryDialoguePortrait,
  existing?: StageActor,
): StageActor {
  const positionId = portrait.positionId ?? existing?.positionId;
  return {
    characterId,
    expressionId: resolvedExpression(document, characterId, expressionId),
    skinId: portrait.skinId ?? undefined,
    distance: portrait.distance ?? existing?.distance ?? "medium",
    positionId,
    transform: characterAssetTransform(
      document,
      characterId,
      portrait.transform ?? existing?.transform,
      positionId,
    ),
    transition: characterTransition(portrait.transition),
    entering: !existing,
    exiting: false,
  };
}

function removeActor(
  state: GalgameStageState,
  characterId: string,
  transition: GalgameStoryCharacterTransition,
) {
  const existing = state.actors[characterId];
  if (!existing) return state;
  return {
    ...state,
    actors: {
      ...state.actors,
      [characterId]: {
        ...existing,
        transition: characterTransition(transition),
        entering: false,
        exiting: true,
      },
    },
  };
}

function actorFromStageCastMember(
  document: GalgameStoryProject,
  member: GalgameStoryStageCastMember,
  existing?: StageActor,
): StageActor {
  return {
    characterId: member.characterId,
    expressionId: resolvedExpression(
      document,
      member.characterId,
      member.expressionId,
    ),
    skinId: member.skinId ?? undefined,
    distance: member.distance ?? "medium",
    positionId: member.positionId ?? undefined,
    transform: characterAssetTransform(
      document,
      member.characterId,
      member.transform,
      member.positionId,
    ),
    transition: characterTransition(member.transition),
    entering: !existing || existing.exiting,
    exiting: false,
  };
}

export function settleStage(state: GalgameStageState): GalgameStageState {
  const actors = Object.fromEntries(
    Object.entries(state.actors)
      .filter(([, actor]) => !actor.exiting)
      .map(([characterId, actor]) => [
        characterId,
        actor.entering ? { ...actor, entering: false } : actor,
      ]),
  );
  return {
    ...state,
    actors,
    cg: state.cg?.entering ? { ...state.cg, entering: false } : state.cg,
    exitingCg: undefined,
    soloActor: undefined,
    hiddenCharacterId: undefined,
    activeSpeakerId: undefined,
    activeSpeakerIds: undefined,
  };
}

export function leaveContentBlock(
  state: GalgameStageState,
  block: GalgameStoryBlock,
): GalgameStageState {
  const settled = settleStage(state);
  if (
    block.type === "dialogue" &&
    block.portrait?.mode === "stage" &&
    block.portrait.keepAfter === false
  )
    return removeActor(
      settled,
      block.characterId,
      block.portrait.transition ?? DEFAULT_CHARACTER_TRANSITION,
    );
  return settled;
}

export function applyAutomaticStageBlock(
  state: GalgameStageState,
  block: GalgameStoryBlock,
  document: GalgameStoryProject,
): GalgameStageState {
  if (block.type === "scene") {
    return {
      ...state,
      sceneId: block.sceneId,
      actors: block.clearCharacters === false ? state.actors : {},
      soloActor: undefined,
      hiddenCharacterId: undefined,
      activeSpeakerId: undefined,
      activeSpeakerIds: undefined,
    };
  }
  if (block.type === "showCg") {
    const cg = (document.cgs ?? []).find(
      (candidate) => candidate.id === block.cgId,
    );
    const variantId = block.variantId ?? cg?.defaultVariantId;
    if (!variantId) return state;
    return {
      ...state,
      exitingCg: state.cg
        ? {
            ...state.cg,
            transition: cgTransition(block.transition),
            entering: false,
            exiting: true,
          }
        : undefined,
      cg: {
        sourceBlockId: block.id,
        cgId: block.cgId,
        variantId,
        displayMode: block.displayMode ?? "fullscreen",
        fit: block.fit,
        overlay: cgOverlay(block.overlay),
        transition: cgTransition(block.transition),
        entering: true,
        exiting: false,
      },
    };
  }
  if (block.type === "hideCg") {
    if (!state.cg) return state;
    return {
      ...state,
      exitingCg: {
        ...state.cg,
        transition: cgTransition(block.transition),
        entering: false,
        exiting: true,
      },
      cg: undefined,
    };
  }
  if (block.type === "showCharacter") {
    const existing = state.actors[block.characterId];
    return {
      ...state,
      actors: {
        ...state.actors,
        [block.characterId]: {
          characterId: block.characterId,
          expressionId: resolvedExpression(
            document,
            block.characterId,
            block.expressionId,
          ),
          distance: block.distance ?? "medium",
          positionId: block.positionId ?? undefined,
          transform: characterAssetTransform(
            document,
            block.characterId,
            block.transform,
            block.positionId,
          ),
          transition: characterTransition(block.transition),
          entering: !existing,
          exiting: false,
        },
      },
    };
  }
  if (block.type === "setStageCast") {
    const castMembers = block.members ?? [];
    const memberIds = new Set(castMembers.map((member) => member.characterId));
    const exitingActors = Object.fromEntries(
      Object.entries(state.actors)
        .filter(
          ([characterId, actor]) =>
            !memberIds.has(characterId) && !actor.exiting,
        )
        .map(([characterId, actor]) => [
          characterId,
          {
            ...actor,
            transition: characterTransition(block.exitTransition),
            entering: false,
            exiting: true,
          },
        ]),
    );
    const members = Object.fromEntries(
      castMembers.map((member) => [
        member.characterId,
        actorFromStageCastMember(
          document,
          member,
          state.actors[member.characterId],
        ),
      ]),
    );
    return {
      ...state,
      actors: { ...exitingActors, ...members },
      soloActor: undefined,
      hiddenCharacterId: undefined,
      activeSpeakerId: undefined,
      activeSpeakerIds: undefined,
    };
  }
  if (block.type === "removeCharacter") {
    if (block.all) {
      return {
        ...state,
        actors: Object.fromEntries(
          Object.entries(state.actors).map(([characterId, actor]) => [
            characterId,
            {
              ...actor,
              transition: characterTransition(block.transition),
              entering: false,
              exiting: true,
            },
          ]),
        ),
      };
    }
    return block.characterId
      ? removeActor(
          state,
          block.characterId,
          block.transition ?? DEFAULT_CHARACTER_TRANSITION,
        )
      : state;
  }
  if (block.type === "destroyScene")
    return {
      ...emptyStageState(),
      autoPlay: state.autoPlay,
      dialoguePreset: state.dialoguePreset,
    };
  if (block.type === "camera")
    return {
      ...state,
      camera: {
        target: block.target,
        x: block.x,
        y: block.y,
        scale: block.scale,
        rotation: block.rotation,
        intensity: block.intensity,
        effect: block.effect,
        durationMs: block.durationMs,
        easing: block.easing,
      },
    };
  if (block.type === "resetCamera")
    return {
      ...state,
      camera: {
        target: "stage",
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        intensity: 0,
        effect: "move",
        durationMs: block.durationMs,
        easing: "easeInOut",
      },
    };
  if (block.type === "particle")
    return {
      ...state,
      particle:
        block.action === "play"
          ? { preset: block.preset, density: block.density }
          : undefined,
    };
  if (block.type === "floatingText")
    return {
      ...state,
      floatingText: {
        text: block.text,
        x: block.x,
        y: block.y,
        color: block.color,
        durationMs: block.durationMs,
      },
    };
  if (block.type === "curtain")
    return {
      ...state,
      curtain:
        block.action === "hide" && !state.curtain
          ? undefined
          : {
              mode:
                block.action === "hide"
                  ? (state.curtain?.mode ?? block.mode)
                  : block.mode,
              color:
                block.action === "hide"
                  ? (state.curtain?.color ?? block.color)
                  : block.color,
              opacity:
                block.action === "hide"
                  ? (state.curtain?.opacity ?? block.opacity)
                  : block.opacity,
              durationMs: block.durationMs,
              visible: block.action === "show",
              action: block.action,
              transitionKey: block.id,
            },
    };
  if (block.type === "video")
    return {
      ...state,
      video:
        block.action === "play" && block.assetId
          ? {
              assetId: block.assetId,
              loop: block.loop,
              volume: block.volume,
              fit: block.fit,
            }
          : undefined,
    };
  if (block.type === "stageAnimation")
    return {
      ...state,
      stageAnimation: {
        target: block.target,
        animation: block.animation,
        durationMs: block.durationMs,
      },
    };
  if (block.type === "animateSprite")
    return {
      ...state,
      spriteAnimations: {
        ...state.spriteAnimations,
        [block.characterId]: {
          sourceBlockId: block.id,
          animation: block.animation,
          direction: block.direction,
          intensity: block.intensity,
          easing: block.easing,
          durationMs: block.durationMs,
          loop: block.loop,
        },
      },
    };
  if (block.type === "autoPlay")
    return {
      ...state,
      autoPlay: { enabled: block.enabled, delayMs: block.delayMs },
    };
  if (block.type === "switchDialogueStyle")
    return { ...state, dialoguePreset: block.preset };
  return state;
}

export function enterContentBlock(
  state: GalgameStageState,
  block: GalgameStoryBlock,
  document: GalgameStoryProject,
): GalgameStageState {
  if (block.type !== "dialogue")
    return {
      ...state,
      soloActor: undefined,
      hiddenCharacterId: undefined,
      activeSpeakerId: undefined,
      activeSpeakerIds: undefined,
    };

  const speakerIds = dialogueSpeakerIds(block);
  const portrait: GalgameStoryDialoguePortrait | undefined = block.portrait
    ? {
        ...block.portrait,
        visible: block.portrait.visible ?? true,
        distance: block.portrait.distance ?? "medium",
      }
    : undefined;
  if (!portrait || portrait.mode === "soloLegacy") {
    const soloPortrait: GalgameStoryDialoguePortrait = portrait ?? {
      mode: "soloLegacy",
      visible: true,
      distance: "medium",
      keepAfter: false,
      transition: DEFAULT_CHARACTER_TRANSITION,
    };
    return {
      ...state,
      soloActor: actorFromPortrait(
        document,
        block.characterId,
        block.expressionId,
        soloPortrait,
      ),
      hiddenCharacterId: undefined,
      activeSpeakerId: block.characterId,
      activeSpeakerIds: speakerIds,
    };
  }
  const dialogueAvatarEnabled = Boolean(
    (document.characters ?? []).find(
      (character) => character.id === block.characterId,
    )?.dialogueAvatar?.enabled,
  );
  if (
    portrait.visible === false ||
    (portrait.mode === "dialogueAvatar" && dialogueAvatarEnabled)
  )
    return {
      ...state,
      soloActor: undefined,
      hiddenCharacterId: block.characterId,
      activeSpeakerId: block.characterId,
      activeSpeakerIds: speakerIds,
    };

  const existing = state.actors[block.characterId];
  const actor = actorFromPortrait(
    document,
    block.characterId,
    block.expressionId,
    portrait,
    existing,
  );
  return {
    ...state,
    actors: { ...state.actors, [block.characterId]: actor },
    soloActor: undefined,
    hiddenCharacterId: undefined,
    activeSpeakerId: block.characterId,
    activeSpeakerIds: speakerIds,
  };
}

export function visibleStageActors(state: GalgameStageState) {
  if (state.soloActor) return [state.soloActor];
  return Object.values(state.actors)
    .filter((actor) => actor.characterId !== state.hiddenCharacterId)
    .sort((left, right) => left.transform.layer - right.transform.layer);
}

export function replayStageToBlock(
  document: GalgameStoryProject,
  fragment: GalgameStoryFragment,
  targetIndex: number,
) {
  let state = emptyStageState();
  let previousContent: GalgameStoryBlock | undefined;
  const blocks = fragment.blocks ?? [];
  for (
    let index = 0;
    index <= targetIndex && index < blocks.length;
    index += 1
  ) {
    if (previousContent) {
      state = leaveContentBlock(state, previousContent);
      previousContent = undefined;
    }
    const block = blocks[index];
    if (
      block.type === "scene" ||
      block.type === "showCg" ||
      block.type === "hideCg" ||
      block.type === "showCharacter" ||
      block.type === "setStageCast" ||
      block.type === "removeCharacter" ||
      block.type === "destroyScene" ||
      block.type === "camera" ||
      block.type === "resetCamera" ||
      block.type === "particle" ||
      block.type === "floatingText" ||
      block.type === "curtain" ||
      block.type === "video" ||
      block.type === "stageAnimation" ||
      block.type === "animateSprite" ||
      block.type === "autoPlay" ||
      block.type === "switchDialogueStyle"
    )
      state = applyAutomaticStageBlock(state, block, document);
    else if (block.type !== "audio" && block.type !== "endChapter") {
      state = enterContentBlock(state, block, document);
      previousContent = block;
    }
  }
  return state;
}

export function replayStageAtTime(
  document: GalgameStoryProject,
  fragment: GalgameStoryFragment,
  milliseconds: number,
) {
  let state = emptyStageState();
  for (const event of timelineEvents(fragment)) {
    if (event.timeMs > milliseconds) break;
    if (
      event.block.type === "scene" ||
      event.block.type === "showCg" ||
      event.block.type === "hideCg" ||
      event.block.type === "showCharacter" ||
      event.block.type === "setStageCast" ||
      event.block.type === "removeCharacter" ||
      event.block.type === "destroyScene" ||
      event.block.type === "camera" ||
      event.block.type === "resetCamera" ||
      event.block.type === "particle" ||
      event.block.type === "floatingText" ||
      event.block.type === "curtain" ||
      event.block.type === "video" ||
      event.block.type === "stageAnimation" ||
      event.block.type === "animateSprite" ||
      event.block.type === "autoPlay" ||
      event.block.type === "switchDialogueStyle"
    )
      state = applyAutomaticStageBlock(state, event.block, document);
  }
  const active = activeTimelineCue(fragment, milliseconds);
  if (!active) return { stage: state };
  return {
    stage: enterContentBlock(state, active.block, document),
    block: active.block,
    blockIndex: active.blockIndex,
  };
}
