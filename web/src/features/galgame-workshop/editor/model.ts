import type {
  GalgameStoryBlock,
  GalgameStoryAudioBlock,
  GalgameStoryAudioAsset,
  GalgameStoryBranchBlock,
  GalgameStoryChapter,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  normalizeStoryProject,
  DEFAULT_DIALOGUE_BOX_STYLE,
  DEFAULT_STAGE_STYLE,
  DEFAULT_UI_STYLE,
} from "@features/galgame-workshop/api/storyNormalization";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import {
  DEFAULT_CHARACTER_TRANSFORM,
  DEFAULT_CHARACTER_TRANSITION,
} from "@features/galgame-workshop/editor/stage";
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";
import { characterStageSettings } from "@features/galgame-workshop/editor/characterStageSettings";
import {
  suggestCharacterPresentation,
  type CharacterPresentationStage,
} from "@features/galgame-workshop/editor/characterPresentation";

export {
  characterStageSettings,
  DEFAULT_CHARACTER_POSITION_PRESETS,
  DEFAULT_STORY_SETTINGS,
  normalizeCharacterStageSettings,
  type ResolvedCharacterStageSettings,
} from "@features/galgame-workshop/editor/characterStageSettings";

export type EditorWorkspace =
  "script" | "assets" | "narrative" | "personalization" | "settings";
export type AssetSection =
  "overview" | "characters" | "scenes" | "bgm" | "sfx" | "voice" | "video";
export type BlockKind = GalgameStoryBlock["type"];
export type AudioChannel = GalgameStoryAudioBlock["channel"];
export type AudioRole = GalgameStoryAudioAsset["role"];

export const AUDIO_ROLE_LABELS: Record<AudioRole, string> = {
  voiceSample: "角色样本",
  voiceLine: "对白配音",
  timelineMaster: "时间轴主音轨",
  backgroundMusic: "背景音乐",
  ambientSound: "环境音",
  soundEffect: "音效",
};

export const AUDIO_CHANNEL_ROLES: Record<AudioChannel, AudioRole> = {
  bgm: "backgroundMusic",
  ambient: "ambientSound",
  sfx: "soundEffect",
};

export { DEFAULT_DIALOGUE_BOX_STYLE, DEFAULT_STAGE_STYLE, DEFAULT_UI_STYLE };

export function stableId() {
  return crypto.randomUUID().toLowerCase();
}

const completedStoryDocumentCache = new WeakMap<
  GalgameStoryProject,
  GalgameStoryProject
>();

export function completeStoryDocument(
  document: GalgameStoryProject,
): GalgameStoryProject {
  const cached = completedStoryDocumentCache.get(document);
  if (cached) return cached;
  const completed = normalizeStoryProject(document);
  completedStoryDocumentCache.set(document, completed);
  return completed;
}

export function firstChapter(document: GalgameStoryProject) {
  return document.chapters?.[0];
}

export function entryChapter(document: GalgameStoryProject) {
  return (
    document.chapters?.find(
      (chapter) => chapter.id === document.entryChapterId,
    ) ?? [...(document.chapters ?? [])].sort((a, b) => a.order - b.order)[0]
  );
}

export function chapterById(document: GalgameStoryProject, chapterId: string) {
  return document.chapters?.find((chapter) => chapter.id === chapterId);
}

export function fragmentById(chapter: GalgameStoryChapter, fragmentId: string) {
  return chapter.fragments?.find((fragment) => fragment.id === fragmentId);
}

export function isTerminator(block: GalgameStoryBlock) {
  return block.type === "endChapter" || block.type === "returnToEntry";
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function makeBlock(
  kind: BlockKind,
  document: GalgameStoryProject,
  chapter: GalgameStoryChapter,
  fragment: GalgameStoryFragment,
  presentationStage?: CharacterPresentationStage,
): GalgameStoryBlock | undefined {
  const characters = document.characters ?? [];
  const scenes = document.scenes ?? [];
  const usableCgs = (document.cgs ?? []).filter(
    (cg) =>
      cg.defaultVariantId &&
      (cg.variants ?? []).some((variant) => variant.id === cg.defaultVariantId),
  );
  if (kind === "scene") {
    if (!scenes[0]) return undefined;
    return {
      id: stableId(),
      type: "scene",
      sceneId: scenes[0].id,
      clearCharacters: true,
    };
  }
  if (kind === "showCg") {
    if (!usableCgs[0]) return undefined;
    return {
      id: stableId(),
      type: "showCg",
      cgId: usableCgs[0].id,
      variantId: null,
      displayMode: "fullscreen",
      fit: "cover",
      overlay: {
        x: 50,
        y: 50,
        width: 60,
        opacity: 1,
        placement: "frontOfCharacters",
      },
      transition: { durationMs: 400, fade: true },
    };
  }
  if (kind === "hideCg")
    return {
      id: stableId(),
      type: "hideCg",
      transition: { durationMs: 400, fade: true },
    };
  if (kind === "showCharacter") {
    if (!characters[0]) return undefined;
    const stageSettings = characterStageSettings(document, characters[0].id);
    const presentation = suggestCharacterPresentation(
      document,
      characters[0].id,
      presentationStage,
    );
    const defaultPosition =
      stageSettings.positionPresets.find(
        (preset) => preset.id === presentation.positionId,
      ) ?? stageSettings.positionPresets[0];
    return {
      id: stableId(),
      type: "showCharacter",
      characterId: characters[0].id,
      expressionId: null,
      distance: presentation.distance,
      positionId: presentation.positionId,
      transform: {
        ...DEFAULT_CHARACTER_TRANSFORM,
        x: defaultPosition.x,
        y: defaultPosition.y,
        anchor: stageSettings.anchor,
        scale: stageSettings.legacyDefaultScale ?? 1,
      },
      transition: DEFAULT_CHARACTER_TRANSITION,
    };
  }
  if (kind === "setStageCast") {
    if (!characters[0]) return undefined;
    const stageSettings = characterStageSettings(document, characters[0].id);
    const presentation = suggestCharacterPresentation(
      document,
      characters[0].id,
      presentationStage,
    );
    const defaultPosition =
      stageSettings.positionPresets.find(
        (preset) => preset.id === presentation.positionId,
      ) ?? stageSettings.positionPresets[0];
    return {
      id: stableId(),
      type: "setStageCast",
      members: [
        {
          characterId: characters[0].id,
          expressionId: null,
          distance: presentation.distance,
          positionId: presentation.positionId,
          transform: {
            ...DEFAULT_CHARACTER_TRANSFORM,
            x: defaultPosition.x,
            y: defaultPosition.y,
            anchor: stageSettings.anchor,
            scale: stageSettings.legacyDefaultScale ?? 1,
          },
          transition: DEFAULT_CHARACTER_TRANSITION,
        },
      ],
      exitTransition: DEFAULT_CHARACTER_TRANSITION,
    };
  }
  if (kind === "removeCharacter") {
    if (!characters[0]) return undefined;
    return {
      id: stableId(),
      type: "removeCharacter",
      characterId: characters[0].id,
      all: false,
      transition: DEFAULT_CHARACTER_TRANSITION,
    };
  }
  if (kind === "dialogue") {
    if (!characters[0]) return undefined;
    const presentation = suggestCharacterPresentation(
      document,
      characters[0].id,
      presentationStage,
    );
    return {
      id: stableId(),
      type: "dialogue",
      characterId: characters[0].id,
      text: "",
      voiceVolume: 100,
      hideDialogueAfter: false,
      portrait: {
        mode: "stage",
        visible: true,
        distance: presentation.distance,
        positionId: presentation.positionId,
        keepAfter: true,
        transform: null,
        transition: DEFAULT_CHARACTER_TRANSITION,
      },
    };
  }
  if (kind === "narration") {
    return {
      id: stableId(),
      type: "narration",
      text: "",
      hideDialogueAfter: false,
    };
  }
  if (kind === "audio") return undefined;
  if (kind === "endChapter") {
    return {
      id: stableId(),
      type: "endChapter",
      endingId: stableId(),
      label: "结局",
    };
  }
  if (kind === "returnToEntry")
    return { id: stableId(), type: "returnToEntry" };
  if (kind === "video") {
    const video = (document.assets ?? []).find(
      (candidate) => candidate.type === "video",
    );
    if (!video) return undefined;
    return {
      id: stableId(),
      type: "video",
      assetId: video.id,
      action: "play",
      loop: false,
      volume: 100,
      fit: "cover",
      waitForCompletion: true,
    };
  }
  if (kind === "animateSprite") {
    if (!characters[0]) return undefined;
    return {
      id: stableId(),
      type: "animateSprite",
      characterId: characters[0].id,
      animation: "idle",
      direction: "none",
      intensity: 1,
      easing: "easeInOut",
      durationMs: 500,
      loop: false,
      waitForCompletion: false,
    };
  }
  if (kind === "gallery") {
    const asset = document.assets?.[0];
    if (!asset) return undefined;
    return {
      id: stableId(),
      type: "gallery",
      assetId: asset.id,
      action: asset.type === "audio" ? "unlockMusic" : "unlockCg",
    };
  }
  if (kind === "setVariable") {
    const variable = document.variables?.[0];
    if (!variable) return undefined;
    return {
      id: stableId(),
      type: "setVariable",
      variableId: variable.id,
      operator: "set",
      value: variable.defaultValue,
    };
  }
  if (kind === "if") {
    const target = chapter.fragments?.find(
      (candidate) => candidate.id !== fragment.id,
    );
    if (!target) return undefined;
    return {
      id: stableId(),
      type: "if",
      condition: document.variables?.[0]?.id ?? "true",
      thenFragmentId: target.id,
      elseFragmentId: null,
    };
  }
  if (kind === "callFragment") {
    const target = chapter.fragments?.find(
      (candidate) => candidate.id !== fragment.id,
    );
    if (!target) return undefined;
    return {
      id: stableId(),
      type: "callFragment",
      targetFragmentId: target.id,
    };
  }
  if (kind !== "branch" && kind in BLOCK_REGISTRY) {
    return {
      id: stableId(),
      type: kind,
      ...BLOCK_REGISTRY[kind].defaults(),
    } as GalgameStoryBlock;
  }
  const targets = (chapter.fragments ?? []).filter(
    (candidate) => candidate.id !== fragment.id,
  );
  if (targets.length < 2) return undefined;
  return {
    id: stableId(),
    type: "branch",
    prompt: "你要怎么选择？",
    choices: targets.slice(0, 2).map((target, index) => ({
      id: stableId(),
      text: `选项 ${index + 1}`,
      targetFragmentId: target.id,
    })),
  };
}

export function makeAudioBlock(
  document: GalgameStoryProject,
  action: "play" | "stop",
  channel: AudioChannel,
): GalgameStoryAudioBlock | undefined {
  const defaults =
    channel === "sfx"
      ? { volume: 100, loop: false, fadeMs: 0 }
      : { volume: 70, loop: true, fadeMs: 1000 };
  if (action === "stop")
    return {
      id: stableId(),
      type: "audio",
      action,
      channel,
      assetId: null,
      ...defaults,
    };
  const asset = (document.assets ?? []).find(
    (candidate) =>
      candidate.type === "audio" &&
      candidate.role === AUDIO_CHANNEL_ROLES[channel],
  );
  if (!asset) return undefined;
  return {
    id: stableId(),
    type: "audio",
    action,
    channel,
    assetId: asset.id,
    ...defaults,
  };
}

export type AudioReference = {
  kind: "characterVoiceSample" | "dialogueVoice" | "audioBlock";
  label: string;
  characterId?: string;
  chapterId?: string;
  fragmentId?: string;
  blockId?: string;
};

export function audioReferences(
  document: GalgameStoryProject,
  assetId: string,
): AudioReference[] {
  const references: AudioReference[] = [];
  for (const character of document.characters ?? []) {
    if (character.voiceProfile?.sampleAssetId === assetId)
      references.push({
        kind: "characterVoiceSample",
        characterId: character.id,
        label: `角色“${character.name}”的声线样本`,
      });
  }
  for (const chapter of document.chapters ?? []) {
    for (const fragment of chapter.fragments ?? []) {
      for (const [index, block] of (fragment.blocks ?? []).entries()) {
        const kind =
          block.type === "dialogue" && block.voiceAssetId === assetId
            ? "dialogueVoice"
            : block.type === "audio" && block.assetId === assetId
              ? "audioBlock"
              : undefined;
        if (!kind) continue;
        references.push({
          kind,
          chapterId: chapter.id,
          fragmentId: fragment.id,
          blockId: block.id,
          label: `${chapter.title} · ${fragment.title} · Block ${index + 1}`,
        });
      }
    }
  }
  return references;
}

export function referencedBy(
  document: GalgameStoryProject,
  kind: "character" | "scene" | "fragment" | "variable",
  id: string,
) {
  const references: string[] = [];
  for (const chapter of document.chapters ?? []) {
    if (kind === "fragment" && chapter.entryFragmentId === id)
      references.push(`章节“${chapter.title}”入口`);
    for (const fragment of chapter.fragments ?? []) {
      for (const block of fragment.blocks ?? []) {
        if (
          (kind === "character" &&
            ((block.type === "dialogue" &&
              dialogueSpeakerIds(block).includes(id)) ||
              ((block.type === "showCharacter" ||
                block.type === "removeCharacter" ||
                block.type === "animateSprite") &&
                block.characterId === id))) ||
          (kind === "scene" && block.type === "scene" && block.sceneId === id)
        )
          references.push(`Fragment“${fragment.title}”`);
        if (kind === "fragment" && block.type === "branch") {
          for (const choice of block.choices) {
            if (choice.targetFragmentId === id)
              references.push(`Fragment“${fragment.title}”的分支`);
          }
        }
        if (
          kind === "fragment" &&
          ((block.type === "callFragment" && block.targetFragmentId === id) ||
            (block.type === "if" &&
              (block.thenFragmentId === id || block.elseFragmentId === id)))
        )
          references.push(`Fragment“${fragment.title}”的调用`);
        if (
          kind === "variable" &&
          ((block.type === "setVariable" && block.variableId === id) ||
            (block.type === "if" && block.condition.includes(id)))
        )
          references.push(`Fragment“${fragment.title}”的变量逻辑`);
      }
    }
  }
  return [...new Set(references)];
}

export function updateFirstChapter(
  document: GalgameStoryProject,
  updater: (chapter: GalgameStoryChapter) => GalgameStoryChapter,
) {
  const chapters = document.chapters ?? [];
  if (!chapters[0]) return document;
  return {
    ...document,
    chapters: [updater(chapters[0]), ...chapters.slice(1)],
  };
}

export function updateChapter(
  document: GalgameStoryProject,
  chapterId: string,
  updater: (chapter: GalgameStoryChapter) => GalgameStoryChapter,
) {
  return {
    ...document,
    chapters: (document.chapters ?? []).map((chapter) =>
      chapter.id === chapterId ? updater(chapter) : chapter,
    ),
  };
}

export function updateFragment(
  document: GalgameStoryProject,
  fragmentId: string,
  updater: (fragment: GalgameStoryFragment) => GalgameStoryFragment,
) {
  return {
    ...document,
    chapters: (document.chapters ?? []).map((chapter) => ({
      ...chapter,
      fragments: (chapter.fragments ?? []).map((fragment) =>
        fragment.id === fragmentId ? updater(fragment) : fragment,
      ),
    })),
  };
}

export function updateBlock(
  document: GalgameStoryProject,
  fragmentId: string,
  blockId: string,
  updater: (block: GalgameStoryBlock) => GalgameStoryBlock,
) {
  return updateFragment(document, fragmentId, (fragment) => ({
    ...fragment,
    blocks: (fragment.blocks ?? []).map((block) =>
      block.id === blockId ? updater(block) : block,
    ),
  }));
}

export function scenePalette(sceneId?: string) {
  if (!sceneId) return { first: "#202737", second: "#10131d" };
  let hash = 0;
  for (const character of sceneId)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    first: `hsl(${hue} 42% 31%)`,
    second: `hsl(${(hue + 34) % 360} 34% 13%)`,
  };
}

export function branchBlock(block: GalgameStoryBlock) {
  return block as GalgameStoryBranchBlock;
}
