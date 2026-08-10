import { describe, expect, it } from "vitest";
import type { GalgameStoryCharacter } from "@features/galgame-workshop/api";
import {
  characterExpressionAssetId,
  dialogueDisplayName,
  inlineExpressionAt,
  plainRichText,
  resolvedRichTextDocument,
  richTextPlainText,
  richTextSummary,
  richTextWaitEvents,
  truncateRichText,
} from "@features/galgame-workshop/editor/richText";

const character: GalgameStoryCharacter = {
  id: "hero",
  name: "本名",
  description: "",
  themeColor: "#E75B55",
  displayNames: [
    {
      id: "alias",
      label: "固定别名",
      source: "literal",
      value: "凤凰院凶真",
    },
    {
      id: "variable-name",
      label: "变量名",
      source: "variable",
      variableId: "player-name",
    },
  ],
  expressions: [
    { id: "neutral", label: "平静", assetId: "portrait-default" },
    { id: "smile", label: "微笑", assetId: "portrait-smile" },
  ],
  defaultExpressionId: "neutral",
  portraitSkins: [
    {
      id: "winter",
      name: "冬装",
      overrides: [{ expressionId: "smile", assetId: "portrait-winter" }],
    },
  ],
  attributes: {},
};

describe("official rich text document", () => {
  it("projects compatible text while retaining semantic nodes", () => {
    const content = {
      version: 1 as const,
      nodes: [
        { type: "text" as const, text: "你好" },
        { type: "ruby" as const, text: "世界", reading: "せかい" },
        { type: "lineBreak" as const },
        { type: "variable" as const, variableId: "player-name" },
        { type: "wait" as const, mode: "duration" as const, durationMs: 500 },
      ],
    };

    expect(richTextPlainText(content)).toBe("你好世界\n");
    expect(richTextSummary(content)).toContain("世界(せかい)");
    expect(richTextWaitEvents(content, { "player-name": "真由理" })).toEqual([
      { offset: 8, node: content.nodes[4] },
    ]);
    expect(
      resolvedRichTextDocument(content, { "player-name": "真由理" }).nodes,
    ).toContainEqual({
      type: "text",
      text: "真由理",
    });
  });

  it("truncates visible text and activates inline expressions by cursor", () => {
    const content = {
      version: 1 as const,
      nodes: [
        { type: "text" as const, text: "前" },
        { type: "expression" as const, expressionId: "smile" },
        { type: "text" as const, text: "后续" },
      ],
    };

    expect(richTextPlainText(truncateRichText(content, {}, 2))).toBe("前后");
    expect(inlineExpressionAt(content, 0)).toBeUndefined();
    expect(inlineExpressionAt(content, 1)).toBe("smile");
  });

  it("resolves display names and skin overrides with safe fallbacks", () => {
    expect(dialogueDisplayName(character, "alias", {})).toBe("凤凰院凶真");
    expect(
      dialogueDisplayName(character, "variable-name", {
        "player-name": "助手",
      }),
    ).toBe("助手");
    expect(dialogueDisplayName(character, "missing", {})).toBe("本名");
    expect(characterExpressionAssetId(character, "smile", "winter")).toBe(
      "portrait-winter",
    );
    expect(characterExpressionAssetId(character, "neutral", "winter")).toBe(
      "portrait-default",
    );
    expect(plainRichText("旧文本").nodes).toEqual([
      { type: "text", text: "旧文本" },
    ]);
  });
});
