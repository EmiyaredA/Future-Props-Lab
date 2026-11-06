import { describe, expect, it } from "vitest";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import {
  addLocalizationTarget,
  localizationEntry,
  localizationStatus,
  localizedStoryDocument,
  pruneStoryLocalizations,
  setLocalizationDefaultLocale,
  storyTranslationUnits,
  updateLocalizationEntry,
} from "@features/galgame-workshop/editor/localization";

function story(): GalgameStoryProject {
  return {
    schemaVersion: "1.0",
    synopsis: "",
    characters: [{ id: "hero", name: "主角", description: "" }],
    scenes: [],
    variables: [],
    assets: [],
    chapters: [
      {
        id: "chapter-1",
        title: "第一章",
        order: 1,
        entryFragmentId: "main",
        fragments: [
          {
            id: "main",
            title: "main",
            blocks: [
              {
                id: "dialogue",
                type: "dialogue",
                characterId: "hero",
                text: "你好。",
              },
              {
                id: "message",
                type: "systemMessage",
                title: "保存",
                text: "是否保存？",
                acceptLabel: "确认",
                cancelLabel: "取消",
                mode: "confirm",
                tone: "info",
              },
              {
                id: "branch",
                type: "branch",
                prompt: "去哪里？",
                choices: [
                  { id: "left", text: "左边", targetFragmentId: "ending" },
                ],
              },
              { id: "end", type: "endChapter", label: "结束", endingId: null },
            ],
          },
          {
            id: "ending",
            title: "ending",
            blocks: [{ id: "ending-text", type: "narration", text: "终点。" }],
          },
        ],
      },
    ],
  };
}

describe("story localization", () => {
  it("extracts stable player-visible translation units", () => {
    const units = storyTranslationUnits(story());
    expect(units.map((unit) => unit.key)).toEqual([
      "dialogue:text:",
      "message:title:",
      "message:text:",
      "message:acceptLabel:",
      "message:cancelLabel:",
      "branch:prompt:",
      "branch:choiceText:left",
      "end:label:",
      "ending-text:text:",
    ]);
  });

  it("persists fresh entries and applies the default or explicit locale", () => {
    const source = story();
    const [dialogue, , , , , prompt, choice] = storyTranslationUnits(source);
    let translated = updateLocalizationEntry(
      source,
      "en-US",
      dialogue,
      "Hello.",
    );
    translated = updateLocalizationEntry(
      translated,
      "en-US",
      prompt,
      "Where to?",
    );
    translated = updateLocalizationEntry(translated, "en-US", choice, "Left");
    translated = setLocalizationDefaultLocale(translated, "en-US");

    const localized = localizedStoryDocument(translated);
    const blocks = localized.chapters![0].fragments![0].blocks!;
    expect(blocks[0]).toMatchObject({ text: "Hello." });
    expect(blocks[2]).toMatchObject({
      prompt: "Where to?",
      choices: [{ id: "left", text: "Left" }],
    });
    expect(localizedStoryDocument(translated, "zh-CN")).toBe(translated);
  });

  it("retains stale text for review but falls back during official playback", () => {
    const source = story();
    const unit = storyTranslationUnits(source)[0];
    const translated = updateLocalizationEntry(source, "en-US", unit, "Hello.");
    const changed = structuredClone(translated);
    const block = changed.chapters![0].fragments![0].blocks![0];
    if (block.type === "dialogue") block.text = "你好，世界。";
    const currentUnit = storyTranslationUnits(changed)[0];

    expect(
      localizationStatus(
        localizationEntry(changed, "en-US", currentUnit),
        currentUnit,
      ),
    ).toBe("stale");
    expect(
      localizedStoryDocument(changed, "en-US").chapters![0].fragments![0]
        .blocks![0],
    ).toMatchObject({ text: "你好，世界。" });
    expect(
      localizedStoryDocument(changed, "en-US", { includeStale: true })
        .chapters![0].fragments![0].blocks![0],
    ).toMatchObject({ text: "Hello." });
  });

  it("removes translations whose block or choice no longer exists", () => {
    const source = story();
    const choice = storyTranslationUnits(source).find(
      (unit) => unit.field === "choiceText",
    )!;
    let translated = updateLocalizationEntry(source, "ja-JP", choice, "左");
    const branch = translated.chapters![0].fragments![0].blocks![2];
    if (branch.type === "branch") branch.choices = [];
    translated = pruneStoryLocalizations(translated);
    expect(translated.localizations?.targets?.[0].entries).toEqual([]);
  });

  it("adds a target without changing the startup locale", () => {
    const next = addLocalizationTarget(story(), "JA-jp");
    expect(next.localizations).toMatchObject({
      sourceLocale: "zh-CN",
      defaultLocale: "zh-CN",
      targets: [{ locale: "ja-JP", entries: [] }],
    });
  });
});
