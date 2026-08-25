import type {
  GalgameStoryBlock,
  GalgameStoryCgOverlay,
  GalgameStoryCgTransition,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";

export const DEFAULT_CG_TRANSITION: Required<GalgameStoryCgTransition> = {
  durationMs: 400,
  fade: true,
};
export const DEFAULT_SCENE_TRANSITION: Required<GalgameStoryCgTransition> = {
  durationMs: 0,
  fade: false,
};
export const DEFAULT_CG_OVERLAY: Required<GalgameStoryCgOverlay> = {
  x: 50,
  y: 50,
  width: 60,
  opacity: 1,
  placement: "frontOfCharacters",
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

export type StageScene = {
  sourceBlockId: string;
  sceneId: string;
  transition: Required<GalgameStoryCgTransition>;
  entering: boolean;
  exiting: boolean;
};

type VisualStageState = {
  sceneId?: string;
  scene?: StageScene;
  exitingScene?: StageScene;
  cg?: StageCg;
  exitingCg?: StageCg;
  actors: object;
  soloActor?: unknown;
  hiddenCharacterId?: string;
  activeSpeakerId?: string;
  activeSpeakerIds?: string[];
};

export const cgTransition = (
  value?: GalgameStoryCgTransition | null,
): Required<GalgameStoryCgTransition> => ({
  ...DEFAULT_CG_TRANSITION,
  ...value,
});
export const sceneTransition = (
  value?: GalgameStoryCgTransition | null,
): Required<GalgameStoryCgTransition> => ({
  ...DEFAULT_SCENE_TRANSITION,
  ...value,
});
export const cgOverlay = (
  value?: GalgameStoryCgOverlay | null,
): Required<GalgameStoryCgOverlay> => ({
  ...DEFAULT_CG_OVERLAY,
  ...value,
});

export function applyVisualStageBlock<T extends VisualStageState>(
  state: T,
  block: GalgameStoryBlock,
  document: GalgameStoryProject,
): T | undefined {
  if (block.type === "scene") {
    const transition = sceneTransition(block.transition);
    const previous =
      state.scene ??
      (state.sceneId
        ? {
            sourceBlockId: "legacy-scene",
            sceneId: state.sceneId,
            transition: DEFAULT_SCENE_TRANSITION,
            entering: false,
            exiting: false,
          }
        : undefined);
    return {
      ...state,
      sceneId: block.sceneId,
      exitingScene:
        previous && previous.sceneId !== block.sceneId
          ? { ...previous, transition, entering: false, exiting: true }
          : undefined,
      scene: {
        sourceBlockId: block.id,
        sceneId: block.sceneId,
        transition,
        entering: previous?.sceneId !== block.sceneId,
        exiting: false,
      },
      actors: block.clearCharacters === false ? state.actors : {},
      soloActor: undefined,
      hiddenCharacterId: undefined,
      activeSpeakerId: undefined,
      activeSpeakerIds: undefined,
    } as T;
  }
  if (block.type === "showCg") {
    const cg = (document.cgs ?? []).find(
      (candidate) => candidate.id === block.cgId,
    );
    const variantId = block.variantId ?? cg?.defaultVariantId;
    if (!variantId) return state;
    const transition = cgTransition(block.transition);
    return {
      ...state,
      exitingCg: state.cg
        ? { ...state.cg, transition, entering: false, exiting: true }
        : undefined,
      cg: {
        sourceBlockId: block.id,
        cgId: block.cgId,
        variantId,
        displayMode: block.displayMode ?? "fullscreen",
        fit: block.fit,
        overlay: cgOverlay(block.overlay),
        transition,
        entering: true,
        exiting: false,
      },
    } as T;
  }
  if (block.type === "hideCg")
    return state.cg
      ? ({
          ...state,
          exitingCg: {
            ...state.cg,
            transition: cgTransition(block.transition),
            entering: false,
            exiting: true,
          },
          cg: undefined,
        } as T)
      : state;
  return undefined;
}

export function settleVisualBlock<T extends VisualStageState>(
  state: T,
  block: GalgameStoryBlock,
): T {
  if (block.type === "scene")
    return {
      ...state,
      scene:
        state.scene?.sourceBlockId === block.id
          ? { ...state.scene, entering: false }
          : state.scene,
      exitingScene: undefined,
    } as T;
  if (block.type === "showCg" || block.type === "hideCg")
    return {
      ...state,
      cg:
        state.cg?.sourceBlockId === block.id
          ? { ...state.cg, entering: false }
          : state.cg,
      exitingCg: undefined,
    } as T;
  return state;
}
