import type {
  GalgameStoryDocument,
  GalgameStoryBlock,
  GalgameStoryAsset,
  GalgameStoryProject,
  CurrentGalgameStoryProject,
  GalgameStoryStageStyle,
  GalgameStoryUiStyle,
  GeneratedGalgameStoryProject,
  GeneratedGalgameStoryBlock,
} from "./types";
import {
  DEFAULT_STORY_SETTINGS,
  normalizeCharacterStageSettings,
} from "./storyDefaults";
import { resolveDialogueBoxStyle } from "./dialogueBoxStyle";

export { DEFAULT_DIALOGUE_BOX_STYLE } from "./dialogueBoxStyle";

export const DEFAULT_UI_STYLE: GalgameStoryUiStyle = { components: [] };

export const DEFAULT_STAGE_STYLE: GalgameStoryStageStyle = {
  speakerFocusEnabled: true,
  inactiveBrightness: 0.6,
  focusTransitionMs: 180,
  lipSyncEnabled: false,
};

export const DEFAULT_TEXT_PLAYBACK_STYLE = { defaultSpeedCps: 40 } as const;
export const DEFAULT_PARAGRAPH_PRESENTATION = {
  defaultStyleRef: { source: "builtin" as const, id: "classic" },
  customStyles: [],
};
export const DEFAULT_SYSTEM_MESSAGE_PRESENTATION = {
  binding: { source: "builtin" as const, id: "standard-message" },
  customStyles: [],
};

type GeneratedStoryAsset = NonNullable<
  GeneratedGalgameStoryProject["assets"]
>[number];

function normalizeAsset(
  asset: GalgameStoryAsset | GeneratedStoryAsset,
): GeneratedStoryAsset {
  if (asset.type !== "image") return asset;
  return {
    ...asset,
    role: asset.role === "sceneBackground" ? "sceneLayer" : asset.role,
  };
}

function normalizeBlock(block: GalgameStoryBlock): GeneratedGalgameStoryBlock {
  if (block.type === "dialogue") {
    return {
      ...block,
      hideDialogueAfter: block.hideDialogueAfter ?? false,
      portrait: block.portrait
        ? {
            ...block.portrait,
            visible: block.portrait.visible ?? true,
            distance: block.portrait.distance ?? "medium",
          }
        : null,
    };
  }
  if (block.type === "narration") {
    return { ...block, hideDialogueAfter: block.hideDialogueAfter ?? false };
  }
  if (block.type === "showCharacter") {
    return { ...block, distance: block.distance ?? "medium" };
  }
  return block;
}

export function normalizeStoryProject(
  document: GeneratedGalgameStoryProject | GalgameStoryProject,
): CurrentGalgameStoryProject {
  const normalized = {
    ...document,
    schemaVersion: "1.4" as const,
    entryChapterId:
      document.entryChapterId ??
      [...(document.chapters ?? [])].sort((a, b) => a.order - b.order)[0]?.id ??
      "chapter-1",
    characterAttributeTemplates: document.characterAttributeTemplates ?? [],
    settings: {
      canvas: {
        ...DEFAULT_STORY_SETTINGS.canvas,
        ...document.settings?.canvas,
      },
      characterStage: normalizeCharacterStageSettings(
        document.settings?.characterStage,
      ),
      characterStageOverrides: Object.fromEntries(
        Object.entries(document.settings?.characterStageOverrides ?? {}).map(
          ([characterId, settings]) => [
            characterId,
            normalizeCharacterStageSettings(settings),
          ],
        ),
      ),
    },
    presentation: {
      ...document.presentation,
      dialogueBox: {
        ...resolveDialogueBoxStyle(document.presentation?.dialogueBox),
      },
      ui: {
        ...DEFAULT_UI_STYLE,
        ...document.presentation?.ui,
        components: document.presentation?.ui?.components ?? [],
      },
      stage: {
        ...DEFAULT_STAGE_STYLE,
        ...document.presentation?.stage,
      },
      text: {
        ...DEFAULT_TEXT_PLAYBACK_STYLE,
        ...document.presentation?.text,
      },
      paragraph: {
        ...DEFAULT_PARAGRAPH_PRESENTATION,
        ...document.presentation?.paragraph,
        defaultStyleRef: {
          ...DEFAULT_PARAGRAPH_PRESENTATION.defaultStyleRef,
          ...document.presentation?.paragraph?.defaultStyleRef,
        },
        customStyles: document.presentation?.paragraph?.customStyles ?? [],
      },
      systemMessage: {
        ...DEFAULT_SYSTEM_MESSAGE_PRESENTATION,
        ...document.presentation?.systemMessage,
        binding: {
          ...DEFAULT_SYSTEM_MESSAGE_PRESENTATION.binding,
          ...document.presentation?.systemMessage?.binding,
        },
        customStyles: document.presentation?.systemMessage?.customStyles ?? [],
      },
    },
    sceneGroups: document.sceneGroups ?? [],
    scenes: (document.scenes ?? []).map((scene) => {
      const legacy = scene as typeof scene & {
        backgrounds?: Array<{ id: string; label: string; assetId: string }>;
      };
      return {
        ...scene,
        layers:
          scene.layers ??
          (legacy.backgrounds ?? []).map((background) => ({
            id: background.id,
            name: background.label,
            assetId: background.assetId,
            distance: 1,
            offsetX: 0,
            offsetY: 0,
          })),
        backgrounds: undefined,
        defaultBackgroundId: undefined,
      };
    }),
    cgs: (document.cgs ?? []).map((cg) => ({
      ...cg,
      variants: cg.variants ?? [],
      defaultVariantId: cg.defaultVariantId ?? null,
    })),
    variables: document.variables ?? [],
    assets: (document.assets ?? []).map(normalizeAsset),
    characters: (document.characters ?? []).map((character, index) => ({
      ...character,
      themeColor:
        character.themeColor ??
        [
          "#E75B55",
          "#4AA3DF",
          "#46B978",
          "#A56DE2",
          "#E59B3D",
          "#D85E9D",
          "#32A6A0",
          "#7586E5",
        ][index % 8],
      expressions: (character.expressions ?? []).map((expression) => ({
        ...expression,
        renderMode: expression.renderMode ?? "staticImage",
        flipX: expression.flipX ?? false,
        thumbnailCrop: expression.thumbnailCrop ?? { x: 50, y: 25, scale: 1.8 },
        dialogueAvatar: expression.dialogueAvatar ?? {
          source: "portrait",
          crop: { x: 50, y: 25, scale: 1.8 },
        },
        overlays: expression.overlays ?? [],
      })),
      defaultExpressionId: character.defaultExpressionId ?? null,
      displayNames: character.displayNames ?? [],
      defaultDisplayNameId: character.defaultDisplayNameId ?? null,
      dialogueAvatar: { enabled: character.dialogueAvatar?.enabled ?? false },
      portraitSkins: character.portraitSkins ?? [],
      defaultPortraitSkinId: character.defaultPortraitSkinId ?? null,
    })),
    chapters: (document.chapters ?? []).map((chapter) => ({
      ...chapter,
      disabled: chapter.disabled ?? false,
      fragments: (chapter.fragments ?? []).map((fragment) => ({
        ...fragment,
        blocks: (fragment.blocks ?? []).map(normalizeBlock),
      })),
    })),
    localizations: document.localizations
      ? {
          ...document.localizations,
          targets: (document.localizations.targets ?? []).map((target) => ({
            ...target,
            entries: target.entries ?? [],
          })),
        }
      : null,
  } satisfies CurrentGalgameStoryProject;
  return normalized;
}

export function normalizeStoryDocument(
  response: Omit<GalgameStoryDocument, "document"> & {
    document: GeneratedGalgameStoryProject;
  },
): GalgameStoryDocument {
  return { ...response, document: normalizeStoryProject(response.document) };
}
