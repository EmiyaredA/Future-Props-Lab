import type {
  GalgameStoryBlock,
  GalgameStoryFragment,
  GalgameStoryLocalizationEntry,
  GalgameStoryLocalizations,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { richTextPlainText } from "@features/galgame-workshop/editor/richText";

export type TranslationField = GalgameStoryLocalizationEntry["field"];

export type StoryTranslationUnit = {
  key: string;
  blockId: string;
  blockType: GalgameStoryBlock["type"];
  field: TranslationField;
  choiceId?: string;
  sourceText: string;
  sourceFingerprint: string;
  label: string;
};

export const DEFAULT_SOURCE_LOCALE = "zh-CN";
export const DEFAULT_TARGET_LOCALE = "en-US";

export const COMMON_STORY_LOCALES = [
  { locale: "en-US", label: "English" },
  { locale: "ja-JP", label: "日本語" },
  { locale: "ko-KR", label: "한국어" },
  { locale: "zh-TW", label: "繁體中文" },
  { locale: "fr-FR", label: "Français" },
  { locale: "de-DE", label: "Deutsch" },
] as const;

const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function isStoryLocale(value: string) {
  return LOCALE_PATTERN.test(value.trim());
}

export function canonicalStoryLocale(value: string) {
  const parts = value.trim().split("-");
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 2 || /^\d{3}$/.test(part)) return part.toUpperCase();
      if (part.length === 4)
        return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
      return part;
    })
    .join("-");
}

export function storyLocaleLabel(locale: string) {
  return (
    COMMON_STORY_LOCALES.find(
      (item) => item.locale.toLowerCase() === locale.toLowerCase(),
    )?.label ?? locale
  );
}

export function sourceFingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function translationUnitKey({
  blockId,
  field,
  choiceId,
}: Pick<StoryTranslationUnit, "blockId" | "field" | "choiceId">) {
  return `${blockId}:${field}:${choiceId ?? ""}`;
}

function unit(
  block: GalgameStoryBlock,
  field: TranslationField,
  sourceText: string | null | undefined,
  label: string,
  choiceId?: string,
): StoryTranslationUnit | undefined {
  if (!sourceText?.trim()) return undefined;
  const value: StoryTranslationUnit = {
    key: translationUnitKey({ blockId: block.id, field, choiceId }),
    blockId: block.id,
    blockType: block.type,
    field,
    choiceId,
    sourceText,
    sourceFingerprint: sourceFingerprint(sourceText),
    label,
  };
  return value;
}

export function storyBlockTranslationUnits(block: GalgameStoryBlock) {
  const units: Array<StoryTranslationUnit | undefined> = [];
  if (
    block.type === "narration" ||
    block.type === "dialogue" ||
    block.type === "storyParagraph" ||
    block.type === "floatingText"
  ) {
    units.push(
      unit(
        block,
        "text",
        "content" in block && block.content
          ? richTextPlainText(block.content)
          : block.text,
        "正文",
      ),
    );
  } else if (block.type === "systemMessage") {
    units.push(
      unit(block, "title", block.title, "标题"),
      unit(block, "text", block.text, "正文"),
      unit(block, "acceptLabel", block.acceptLabel, "确认按钮"),
      unit(block, "cancelLabel", block.cancelLabel, "取消按钮"),
    );
  } else if (block.type === "branch") {
    units.push(unit(block, "prompt", block.prompt, "选项提示"));
    for (const choice of block.choices)
      units.push(unit(block, "choiceText", choice.text, "选项", choice.id));
  } else if (block.type === "endChapter") {
    units.push(unit(block, "label", block.label, "结局标签"));
  }
  return units.filter((item): item is StoryTranslationUnit => Boolean(item));
}

export function storyFragmentTranslationUnits(fragment: GalgameStoryFragment) {
  return (fragment.blocks ?? []).flatMap(storyBlockTranslationUnits);
}

export function storyTranslationUnits(document: GalgameStoryProject) {
  return (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap(storyFragmentTranslationUnits),
  );
}

export function storyLocalizations(
  document: GalgameStoryProject,
): GalgameStoryLocalizations {
  return (
    document.localizations ?? {
      sourceLocale: DEFAULT_SOURCE_LOCALE,
      defaultLocale: DEFAULT_SOURCE_LOCALE,
      targets: [],
    }
  );
}

export function localizationEntry(
  document: GalgameStoryProject,
  locale: string,
  unit: StoryTranslationUnit,
) {
  return storyLocalizations(document)
    .targets?.find(
      (target) => target.locale.toLowerCase() === locale.toLowerCase(),
    )
    ?.entries?.find(
      (entry) =>
        entry.blockId === unit.blockId &&
        entry.field === unit.field &&
        (entry.choiceId ?? "") === (unit.choiceId ?? ""),
    );
}

export function localizationStatus(
  entry: GalgameStoryLocalizationEntry | undefined,
  unit: StoryTranslationUnit,
) {
  if (!entry?.text.trim()) return "missing" as const;
  if (entry.sourceFingerprint !== unit.sourceFingerprint)
    return "stale" as const;
  return "translated" as const;
}

function withLocalizations(
  document: GalgameStoryProject,
  localizations: GalgameStoryLocalizations,
): GalgameStoryProject {
  return { ...document, localizations };
}

export function addLocalizationTarget(
  document: GalgameStoryProject,
  requestedLocale: string,
) {
  const locale = canonicalStoryLocale(requestedLocale);
  if (!isStoryLocale(locale)) return document;
  const localizations = storyLocalizations(document);
  if (
    locale.toLowerCase() === localizations.sourceLocale.toLowerCase() ||
    localizations.targets?.some(
      (target) => target.locale.toLowerCase() === locale.toLowerCase(),
    )
  )
    return document;
  return withLocalizations(document, {
    ...localizations,
    targets: [...(localizations.targets ?? []), { locale, entries: [] }],
  });
}

export function removeLocalizationTarget(
  document: GalgameStoryProject,
  locale: string,
) {
  const localizations = storyLocalizations(document);
  const targets = (localizations.targets ?? []).filter(
    (target) => target.locale.toLowerCase() !== locale.toLowerCase(),
  );
  if (targets.length === (localizations.targets?.length ?? 0)) return document;
  return withLocalizations(document, {
    ...localizations,
    defaultLocale:
      localizations.defaultLocale.toLowerCase() === locale.toLowerCase()
        ? localizations.sourceLocale
        : localizations.defaultLocale,
    targets,
  });
}

export function setLocalizationDefaultLocale(
  document: GalgameStoryProject,
  locale: string,
) {
  const localizations = storyLocalizations(document);
  const allowed = [
    localizations.sourceLocale,
    ...(localizations.targets ?? []).map((target) => target.locale),
  ];
  const selected = allowed.find(
    (item) => item.toLowerCase() === locale.toLowerCase(),
  );
  if (!selected || selected === localizations.defaultLocale) return document;
  return withLocalizations(document, {
    ...localizations,
    defaultLocale: selected,
  });
}

export function updateLocalizationEntry(
  document: GalgameStoryProject,
  locale: string,
  unit: StoryTranslationUnit,
  text: string,
) {
  const withTarget = addLocalizationTarget(document, locale);
  const localizations = storyLocalizations(withTarget);
  const targets = (localizations.targets ?? []).map((target) => {
    if (target.locale.toLowerCase() !== locale.toLowerCase()) return target;
    const entries = (target.entries ?? []).filter(
      (entry) =>
        !(
          entry.blockId === unit.blockId &&
          entry.field === unit.field &&
          (entry.choiceId ?? "") === (unit.choiceId ?? "")
        ),
    );
    if (text.trim())
      entries.push({
        blockId: unit.blockId,
        field: unit.field,
        ...(unit.choiceId ? { choiceId: unit.choiceId } : {}),
        sourceFingerprint: unit.sourceFingerprint,
        text,
      });
    return { ...target, entries };
  });
  return withLocalizations(withTarget, { ...localizations, targets });
}

export function pruneStoryLocalizations(document: GalgameStoryProject) {
  if (!document.localizations) return document;
  const validKeys = new Set(
    storyTranslationUnits(document).map((item) => item.key),
  );
  let changed = false;
  const targets = (document.localizations.targets ?? []).map((target) => {
    const entries = (target.entries ?? []).filter((entry) =>
      validKeys.has(
        translationUnitKey({
          blockId: entry.blockId,
          field: entry.field,
          choiceId: entry.choiceId ?? undefined,
        }),
      ),
    );
    const targetChanged = entries.length !== (target.entries?.length ?? 0);
    if (targetChanged) changed = true;
    return targetChanged ? { ...target, entries } : target;
  });
  return changed
    ? { ...document, localizations: { ...document.localizations, targets } }
    : document;
}

function localizedBlock(
  block: GalgameStoryBlock,
  entries: Map<string, GalgameStoryLocalizationEntry>,
  includeStale: boolean,
): GalgameStoryBlock {
  let next = block;
  for (const unit of storyBlockTranslationUnits(block)) {
    const entry = entries.get(unit.key);
    if (
      !entry?.text.trim() ||
      (!includeStale && entry.sourceFingerprint !== unit.sourceFingerprint)
    )
      continue;
    if (unit.field === "choiceText" && next.type === "branch") {
      next = {
        ...next,
        choices: next.choices.map((choice) =>
          choice.id === unit.choiceId
            ? { ...choice, text: entry.text }
            : choice,
        ),
      } as GalgameStoryBlock;
    } else if (
      unit.field === "text" &&
      (next.type === "narration" ||
        next.type === "dialogue" ||
        next.type === "storyParagraph")
    ) {
      next = { ...next, text: entry.text, content: undefined };
    } else if (unit.field === "text" && next.type === "floatingText") {
      next = { ...next, text: entry.text };
    } else {
      next = { ...next, [unit.field]: entry.text } as GalgameStoryBlock;
    }
  }
  return next;
}

export function localizedStoryDocument(
  document: GalgameStoryProject,
  requestedLocale?: string,
  options: { includeStale?: boolean } = {},
) {
  const localizations = storyLocalizations(document);
  const locale = requestedLocale ?? localizations.defaultLocale;
  if (locale.toLowerCase() === localizations.sourceLocale.toLowerCase())
    return document;
  const target = localizations.targets?.find(
    (item) => item.locale.toLowerCase() === locale.toLowerCase(),
  );
  if (!target) return document;
  const entries = new Map(
    (target.entries ?? []).map((entry) => [
      translationUnitKey({
        blockId: entry.blockId,
        field: entry.field,
        choiceId: entry.choiceId ?? undefined,
      }),
      entry,
    ]),
  );
  return {
    ...document,
    chapters: (document.chapters ?? []).map((chapter) => ({
      ...chapter,
      fragments: (chapter.fragments ?? []).map((fragment) => ({
        ...fragment,
        blocks: (fragment.blocks ?? []).map((block) =>
          localizedBlock(block, entries, options.includeStale ?? false),
        ),
      })),
    })),
  };
}
