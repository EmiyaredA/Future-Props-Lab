import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";

const ID_SUFFIX = /\s+# id:([a-z0-9][a-z0-9-]{0,63})\s*$/;

function quote(value: string) {
  return JSON.stringify(value);
}

export function encodeRenpy(blocks: GalgameStoryBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === "comment") return `# ${block.text} # id:${block.id}`;
      if (
        (block.type === "narration" ||
          block.type === "dialogue" ||
          block.type === "storyParagraph") &&
        block.content
      )
        return `studio ${block.type}: ${JSON.stringify(block)} # id:${block.id}`;
      if (block.type === "narration")
        return `${quote(block.text)} # id:${block.id}`;
      if (block.type === "dialogue")
        return `${block.characterId} ${quote(block.text)} # id:${block.id}`;
      if (block.type === "scene")
        return `scene ${block.sceneId}${block.backgroundId ? ` ${block.backgroundId}` : ""} # id:${block.id}`;
      if (block.type === "showCharacter")
        return `show ${block.characterId}${block.expressionId ? ` ${block.expressionId}` : ""} # id:${block.id}`;
      if (block.type === "removeCharacter")
        return `hide ${block.all ? "all" : block.characterId} # id:${block.id}`;
      if (block.type === "callFragment")
        return `call ${block.targetFragmentId} # id:${block.id}`;
      if (block.type === "wait")
        return block.mode === "duration"
          ? `pause ${(block.durationMs ?? 0) / 1000} # id:${block.id}`
          : `studio wait: ${JSON.stringify(block)} # id:${block.id}`;
      return `studio ${block.type}: ${JSON.stringify(block)} # id:${block.id}`;
    })
    .join("\n");
}

function parsedString(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export type RenpyDecodeResult =
  | { blocks: GalgameStoryBlock[]; errors: [] }
  | { blocks?: undefined; errors: string[] };

export function decodeRenpy(
  source: string,
  previous: GalgameStoryBlock[],
  document: GalgameStoryProject,
): RenpyDecodeResult {
  const errors: string[] = [];
  const blocks: GalgameStoryBlock[] = [];
  const previousById = new Map(previous.map((block) => [block.id, block]));
  const knownCharacters = new Set(
    (document.characters ?? []).map((item) => item.id),
  );
  const knownScenes = new Set((document.scenes ?? []).map((item) => item.id));
  const lines = source.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const id =
      line.match(ID_SUFFIX)?.[1] ??
      previous[blocks.length]?.id ??
      crypto.randomUUID();
    const body = line.replace(ID_SUFFIX, "").trim();
    let block: GalgameStoryBlock | undefined;
    if (body.startsWith("#")) {
      block = { id, type: "comment", text: body.slice(1).trim() };
    } else if (body.startsWith('"')) {
      const value = parsedString(body);
      if (value !== undefined)
        block = {
          id,
          type: "narration",
          text: value,
          hideDialogueAfter: false,
        };
    } else if (body.startsWith("studio ")) {
      const matched = body.match(/^studio\s+([A-Za-z]+):\s*(\{.*\})$/);
      if (matched && matched[1] in BLOCK_REGISTRY) {
        try {
          const value = JSON.parse(matched[2]) as Record<string, unknown>;
          block = { ...value, id, type: matched[1] } as GalgameStoryBlock;
        } catch {
          // Report a stable line error below.
        }
      }
    } else if (body.startsWith("scene ")) {
      const [sceneId, backgroundId] = body.slice(6).trim().split(/\s+/);
      if (knownScenes.has(sceneId))
        block = {
          id,
          type: "scene",
          sceneId,
          backgroundId: backgroundId || null,
          clearCharacters: true,
        };
    } else if (body.startsWith("show ")) {
      const [characterId, expressionId] = body.slice(5).trim().split(/\s+/);
      if (knownCharacters.has(characterId))
        block = {
          id,
          type: "showCharacter",
          characterId,
          expressionId: expressionId || null,
          transform: {
            x: 50,
            y: 100,
            scale: 1,
            brightness: 1,
            opacity: 1,
            flipX: false,
            layer: 10,
          },
          transition: { durationMs: 240, fade: true },
        };
    } else if (body.startsWith("hide ")) {
      const target = body.slice(5).trim();
      if (target === "all" || knownCharacters.has(target))
        block = {
          id,
          type: "removeCharacter",
          characterId: target === "all" ? null : target,
          all: target === "all",
          transition: { durationMs: 240, fade: true },
        };
    } else if (body.startsWith("call ")) {
      block = {
        id,
        type: "callFragment",
        targetFragmentId: body.slice(5).trim(),
      };
    } else if (body.startsWith("pause ")) {
      const seconds = Number(body.slice(6));
      if (Number.isFinite(seconds) && seconds >= 0)
        block = {
          id,
          type: "wait",
          mode: "duration",
          durationMs: Math.round(seconds * 1000),
        };
    } else {
      const matched = body.match(/^([a-z0-9][a-z0-9-]{0,63})\s+(".*")$/);
      const value = matched ? parsedString(matched[2]) : undefined;
      if (matched && value !== undefined && knownCharacters.has(matched[1])) {
        const old = previousById.get(id);
        block = {
          id,
          type: "dialogue",
          characterId: matched[1],
          text: value,
          hideDialogueAfter: false,
          voiceVolume: old?.type === "dialogue" ? old.voiceVolume : 100,
          ...(old?.type === "dialogue"
            ? {
                expressionId: old.expressionId,
                voiceAssetId: old.voiceAssetId,
                portrait: old.portrait,
                displayNameId: old.displayNameId,
                hideDialogueAfter: old.hideDialogueAfter,
              }
            : {}),
        };
      }
    }
    if (!block) errors.push(`第 ${index + 1} 行不是可识别的剧本语法`);
    else blocks.push(block);
  }
  return errors.length ? { errors } : { blocks, errors: [] };
}
