import type {
  GalgameStoryBlock,
  GalgameStoryBranchBlock,
  GalgameStoryChapter,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";

export type EditorWorkspace = "script" | "characters" | "scenes" | "report";
export type BlockKind = GalgameStoryBlock["type"];

export function stableId() {
  return crypto.randomUUID().toLowerCase();
}

export function completeStoryDocument(
  document: GalgameStoryProject,
): GalgameStoryProject {
  return {
    ...document,
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
    return { id: stableId(), type: "scene", sceneId: scenes[0].id };
  }
  if (kind === "dialogue") {
    if (!characters[0]) return undefined;
    return {
      id: stableId(),
      type: "dialogue",
      characterId: characters[0].id,
      text: "",
    };
  }
  if (kind === "narration") {
    return { id: stableId(), type: "narration", text: "" };
  }
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
            block.type === "dialogue" &&
            block.characterId === id) ||
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
