import type {
  GalgameStoryBlock,
  GalgameStoryCharacterTransform,
  GalgameStoryCharacterTransition,
  GalgameStoryDialoguePortrait,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { timelineCues } from "@features/galgame-workshop/editor/timeline";

export const DEFAULT_CHARACTER_TRANSFORM: Required<GalgameStoryCharacterTransform> =
  {
    x: 50,
    y: 100,
    scale: 1,
    brightness: 1,
    opacity: 1,
    flipX: false,
    layer: 10,
  };

export const DEFAULT_CHARACTER_TRANSITION: Required<GalgameStoryCharacterTransition> =
  {
    durationMs: 240,
    fade: true,
  };

export type StageActor = {
  characterId: string;
  expressionId?: string;
  transform: Required<GalgameStoryCharacterTransform>;
  transition: Required<GalgameStoryCharacterTransition>;
  entering: boolean;
  exiting: boolean;
};

export type GalgameStageState = {
  sceneId?: string;
  backgroundId?: string;
  actors: Record<string, StageActor>;
  soloActor?: StageActor;
  hiddenCharacterId?: string;
  activeSpeakerId?: string;
};

export function characterTransform(
  value?: GalgameStoryCharacterTransform | null,
): Required<GalgameStoryCharacterTransform> {
  return { ...DEFAULT_CHARACTER_TRANSFORM, ...value };
}

export function characterTransition(
  value?: GalgameStoryCharacterTransition | null,
): Required<GalgameStoryCharacterTransition> {
  return { ...DEFAULT_CHARACTER_TRANSITION, ...value };
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
  return {
    characterId,
    expressionId: resolvedExpression(document, characterId, expressionId),
    transform: portrait.transform
      ? characterTransform(portrait.transform)
      : (existing?.transform ?? characterTransform()),
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
    soloActor: undefined,
    hiddenCharacterId: undefined,
    activeSpeakerId: undefined,
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
    const scene = (document.scenes ?? []).find(
      (candidate) => candidate.id === block.sceneId,
    );
    return {
      ...state,
      sceneId: block.sceneId,
      backgroundId:
        block.backgroundId ?? scene?.defaultBackgroundId ?? undefined,
      actors: block.clearCharacters === false ? state.actors : {},
      soloActor: undefined,
      hiddenCharacterId: undefined,
      activeSpeakerId: undefined,
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
          transform: characterTransform(block.transform),
          transition: characterTransition(block.transition),
          entering: !existing,
          exiting: false,
        },
      },
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
    };

  const portrait = block.portrait;
  if (!portrait || portrait.mode === "solo") {
    const soloPortrait: GalgameStoryDialoguePortrait = portrait ?? {
      mode: "solo",
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
    };
  }
  if (portrait.mode === "hidden")
    return {
      ...state,
      soloActor: undefined,
      hiddenCharacterId: block.characterId,
      activeSpeakerId: undefined,
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
      block.type === "showCharacter" ||
      block.type === "removeCharacter"
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
  const cues = timelineCues(fragment);
  const started = [...cues]
    .reverse()
    .find((cue) => cue.startMs <= milliseconds);
  if (!started) {
    const firstIndex = cues[0]?.blockIndex ?? 0;
    return {
      stage:
        firstIndex > 0
          ? replayStageToBlock(document, fragment, firstIndex - 1)
          : emptyStageState(),
    };
  }
  const entered = replayStageToBlock(document, fragment, started.blockIndex);
  if (milliseconds < started.endMs)
    return {
      stage: entered,
      block: started.block,
      blockIndex: started.blockIndex,
    };
  return {
    stage: leaveContentBlock(entered, started.block),
  };
}
