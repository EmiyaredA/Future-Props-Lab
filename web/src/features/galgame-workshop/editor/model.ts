import type {
  GalgameStoryBlock,
  GalgameStoryAudioBlock,
  GalgameStoryAudioAsset,
  GalgameStoryBranchBlock,
  GalgameStoryChapter,
  GalgameStoryDialogueBoxStyle,
  GalgameStoryFragment,
  GalgameStoryProject,
  GalgameStoryStageStyle,
  GalgameStoryUiStyle,
} from "@features/galgame-workshop/api";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import {
  DEFAULT_CHARACTER_TRANSFORM,
  DEFAULT_CHARACTER_TRANSITION,
} from "@features/galgame-workshop/editor/stage";

export type EditorWorkspace = "script" | "characters" | "scenes" | "audio";
export type BlockKind = GalgameStoryBlock["type"];
export type AudioChannel = GalgameStoryAudioBlock["channel"];
export type AudioRole = GalgameStoryAudioAsset["role"];

export const AUDIO_ROLE_LABELS: Record<AudioRole, string> = {
  voiceSample: "角色样本",
  voiceLine: "对白配音",
  backgroundMusic: "背景音乐",
  ambientSound: "环境音",
  soundEffect: "音效",
  timelineTrack: "剧情时间轴",
};

export const AUDIO_CHANNEL_ROLES: Record<AudioChannel, AudioRole> = {
  bgm: "backgroundMusic",
  ambient: "ambientSound",
  sfx: "soundEffect",
};

export const DEFAULT_DIALOGUE_BOX_STYLE: GalgameStoryDialogueBoxStyle = {
  preset: "dark",
  assetId: null,
  backgroundColor: "#080E18",
  textColor: "#FFFFFF",
  nameColor: "#FFFFFF",
  backgroundOpacity: 0.82,
  borderRadius: 12,
  fontScale: 1,
};

export const DEFAULT_UI_STYLE: GalgameStoryUiStyle = {
  components: [],
};

export const DEFAULT_STAGE_STYLE: GalgameStoryStageStyle = {
  speakerFocusEnabled: true,
  inactiveBrightness: 0.6,
  focusTransitionMs: 180,
  lipSyncEnabled: false,
};

export function stableId() {
  return crypto.randomUUID().toLowerCase();
}

export function completeStoryDocument(
  document: GalgameStoryProject,
): GalgameStoryProject {
  return {
    ...document,
    presentation: {
      ...document.presentation,
      dialogueBox: {
        ...DEFAULT_DIALOGUE_BOX_STYLE,
        ...document.presentation?.dialogueBox,
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
    },
    scenes: (document.scenes ?? []).map((scene) => ({
      ...scene,
      backgrounds: scene.backgrounds ?? [],
      defaultBackgroundId: scene.defaultBackgroundId ?? null,
    })),
    variables: document.variables ?? [],
    assets: document.assets ?? [],
    characters: (document.characters ?? []).map((character) => ({
      ...character,
      expressions: character.expressions ?? [],
      defaultExpressionId: character.defaultExpressionId ?? null,
    })),
    chapters: (document.chapters ?? []).map((chapter) => ({
      ...chapter,
      fragments: (chapter.fragments ?? []).map((fragment) => ({
        ...fragment,
        blocks: fragment.blocks ?? [],
      })),
    })),
  };
}

export function firstChapter(document: GalgameStoryProject) {
  return document.chapters?.[0];
}

export function fragmentById(chapter: GalgameStoryChapter, fragmentId: string) {
  return chapter.fragments?.find((fragment) => fragment.id === fragmentId);
}

export function isTerminator(block: GalgameStoryBlock) {
  return block.type === "branch" || block.type === "endChapter";
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
): GalgameStoryBlock | undefined {
  const characters = document.characters ?? [];
  const scenes = document.scenes ?? [];
  if (kind === "scene") {
    if (!scenes[0]) return undefined;
    return {
      id: stableId(),
      type: "scene",
      sceneId: scenes[0].id,
      clearCharacters: true,
    };
  }
  if (kind === "showCharacter") {
    if (!characters[0]) return undefined;
    return {
      id: stableId(),
      type: "showCharacter",
      characterId: characters[0].id,
      expressionId: null,
      transform: DEFAULT_CHARACTER_TRANSFORM,
      transition: DEFAULT_CHARACTER_TRANSITION,
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
    return {
      id: stableId(),
      type: "dialogue",
      characterId: characters[0].id,
      text: "",
      voiceVolume: 100,
      portrait: {
        mode: "stage",
        keepAfter: true,
        transform: null,
        transition: DEFAULT_CHARACTER_TRANSITION,
      },
    };
  }
  if (kind === "narration") {
    return { id: stableId(), type: "narration", text: "" };
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
  kind:
    | "characterVoiceSample"
    | "dialogueVoice"
    | "audioBlock"
    | "fragmentTimeline";
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
      if (fragment.timeline?.assetId === assetId)
        references.push({
          kind: "fragmentTimeline",
          chapterId: chapter.id,
          fragmentId: fragment.id,
          label: `${chapter.title} · ${fragment.title} · 剧情时间轴`,
        });
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
  kind: "character" | "scene" | "fragment",
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
                block.type === "removeCharacter") &&
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

export function updateFragment(
  document: GalgameStoryProject,
  fragmentId: string,
  updater: (fragment: GalgameStoryFragment) => GalgameStoryFragment,
) {
  return updateFirstChapter(document, (chapter) => ({
    ...chapter,
    fragments: (chapter.fragments ?? []).map((fragment) =>
      fragment.id === fragmentId ? updater(fragment) : fragment,
    ),
  }));
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
