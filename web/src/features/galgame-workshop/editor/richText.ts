import type {
  GalgameStoryCharacter,
  GalgameStoryProject,
  GalgameStoryRichTextDocument,
  GalgameStoryRichTextNode,
} from "@features/galgame-workshop/api";

export type RichTextBlock = {
  text: string;
  content?: GalgameStoryRichTextDocument | null;
};

export const plainRichText = (text: string): GalgameStoryRichTextDocument => ({
  version: 1,
  nodes: text ? [{ type: "text", text }] : [],
});

export function richTextDocument(block: RichTextBlock) {
  return block.content ?? plainRichText(block.text);
}

export function richTextPlainText(content: GalgameStoryRichTextDocument) {
  return (content.nodes ?? [])
    .map((node) => {
      if (node.type === "text" || node.type === "ruby") return node.text;
      if (node.type === "lineBreak") return "\n";
      return "";
    })
    .join("");
}

export function richTextSummary(
  content: GalgameStoryRichTextDocument,
  document?: GalgameStoryProject,
) {
  return (content.nodes ?? [])
    .map((node) => {
      if (node.type === "text") return node.text;
      if (node.type === "ruby") return `${node.text}(${node.reading})`;
      if (node.type === "lineBreak") return "\n";
      if (node.type === "variable") {
        const variable = document?.variables?.find(
          (candidate) => candidate.id === node.variableId,
        );
        return `{{${variable?.name ?? node.variableId}}}`;
      }
      if (node.type === "expression") return `【表情:${node.expressionId}】`;
      return node.mode === "player"
        ? "【等待继续】"
        : `【等待${(node.durationMs ?? 0) / 1000}s】`;
    })
    .join("");
}

export function resolvedRichText(
  content: GalgameStoryRichTextDocument,
  variables: Record<string, string | number | boolean>,
): GalgameStoryRichTextNode[] {
  return (content.nodes ?? []).flatMap((node): GalgameStoryRichTextNode[] => {
    if (node.type === "variable") {
      const value = variables[node.variableId];
      return [{ type: "text", text: value == null ? "" : String(value) }];
    }
    return [node];
  });
}

export function resolvedRichTextDocument(
  content: GalgameStoryRichTextDocument,
  variables: Record<string, string | number | boolean>,
): GalgameStoryRichTextDocument {
  return { version: 1, nodes: resolvedRichText(content, variables) };
}

export function truncateRichText(
  content: GalgameStoryRichTextDocument,
  variables: Record<string, string | number | boolean>,
  maximum: number,
): GalgameStoryRichTextDocument {
  const resolved = resolvedRichTextDocument(content, variables);
  const nodes: GalgameStoryRichTextNode[] = [];
  let remaining = Math.max(0, maximum);
  for (const node of resolved.nodes ?? []) {
    if (node.type === "expression" || node.type === "wait") {
      nodes.push(node);
      continue;
    }
    if (node.type === "lineBreak") {
      if (remaining <= 0) break;
      nodes.push(node);
      remaining -= 1;
      continue;
    }
    if (node.type === "variable") continue;
    const characters = Array.from(node.text);
    if (remaining <= 0) break;
    nodes.push({ ...node, text: characters.slice(0, remaining).join("") });
    remaining -= characters.length;
    if (remaining < 0) break;
  }
  return { version: 1, nodes };
}

export function inlineExpressionAt(
  content: GalgameStoryRichTextDocument,
  visibleLength: number,
) {
  let cursor = 0;
  let expressionId: string | undefined;
  for (const node of content.nodes ?? []) {
    if (node.type === "expression" && cursor <= visibleLength)
      expressionId = node.expressionId;
    else cursor += nodeVisibleLength(node);
  }
  return expressionId;
}

export function richTextWaitEvents(
  content: GalgameStoryRichTextDocument,
  variables: Record<string, string | number | boolean>,
) {
  let offset = 0;
  return (content.nodes ?? []).flatMap((node) => {
    if (node.type === "wait") return [{ offset, node }];
    if (node.type === "text" || node.type === "ruby")
      offset += Array.from(node.text).length;
    else if (node.type === "variable")
      offset += Array.from(String(variables[node.variableId] ?? "")).length;
    else if (node.type === "lineBreak") offset += 1;
    return [];
  });
}

export function characterExpressionAssetId(
  character: GalgameStoryCharacter | undefined,
  expressionId: string | null | undefined,
  skinId: string | null | undefined,
) {
  if (!character) return undefined;
  const targetExpression =
    expressionId ?? character.defaultExpressionId ?? undefined;
  if (!targetExpression) return undefined;
  const resolvedSkinId = skinId ?? character.defaultPortraitSkinId;
  const skin = character.portraitSkins?.find(
    (item) => item.id === resolvedSkinId,
  );
  const override = skin?.overrides?.find(
    (item) => item.expressionId === targetExpression,
  );
  return (
    override?.assetId ??
    character.expressions?.find((item) => item.id === targetExpression)?.assetId
  );
}

export function dialogueDisplayName(
  character: GalgameStoryCharacter | undefined,
  displayNameId: string | null | undefined,
  variables: Record<string, string | number | boolean>,
) {
  if (!character) return "未知角色";
  const resolvedDisplayNameId = displayNameId ?? character.defaultDisplayNameId;
  const scheme = character.displayNames?.find(
    (candidate) => candidate.id === resolvedDisplayNameId,
  );
  if (!scheme) return character.name;
  if (scheme.source === "variable") {
    const value = variables[scheme.variableId ?? ""];
    return typeof value === "string" && value ? value : character.name;
  }
  if (scheme.source === "attribute") {
    const value = character.attributes?.[scheme.attributeId ?? ""];
    return typeof value === "string" && value ? value : character.name;
  }
  return scheme.value || character.name;
}

export function nodeVisibleLength(node: GalgameStoryRichTextNode) {
  if (node.type === "text" || node.type === "ruby")
    return Array.from(node.text).length;
  if (node.type === "variable") return 1;
  if (node.type === "lineBreak") return 1;
  return 0;
}
