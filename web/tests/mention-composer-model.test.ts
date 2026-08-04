import { describe, expect, it } from "vitest";
import {
  findMentionAtCaret,
  mentionPartLength,
  mentionProjection,
  normalizeMentionParts,
} from "@features/visual-workshop/mention-composer/model";

type Part =
  | { key: string; type: "text"; text: string }
  | { key: string; type: "asset"; name: string };

let sequence = 0;
const textPart = (text = ""): Extract<Part, { type: "text" }> => ({
  key: `text-${(sequence += 1)}`,
  type: "text",
  text,
});

describe("headless mention composer model", () => {
  it("normalizes token boundaries and projects a controlled value", () => {
    const parts = normalizeMentionParts<Part>(
      [
        textPart("开头\u200b"),
        textPart("内容"),
        { key: "asset-1", type: "asset", name: "参考图" },
      ],
      textPart,
      { leadingText: true },
    );
    expect(parts.map((part) => part.type)).toEqual(["text", "asset", "text"]);
    expect(mentionProjection(parts, (part) => `@${part.name}`)).toBe(
      "开头内容@参考图",
    );
    expect(mentionPartLength(parts[1], (part) => `@${part.name}`)).toBe(4);
  });

  it("finds a mention query at the caret without crossing text parts", () => {
    const part = textPart("请使用 @参考");
    expect(
      findMentionAtCaret<Part>([part], {
        key: part.key,
        offset: part.text.length,
      }),
    ).toEqual({ key: part.key, offset: 7, start: 4, query: "参考" });
    expect(
      findMentionAtCaret<Part>([part], { key: "missing", offset: 1 }),
    ).toBeNull();
  });
});
